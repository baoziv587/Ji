// The sessions over HTTP: JSON for what a client asks and does, and Server-Sent Events for what happens, so a client
// needs nothing but an HTTP library.
//
//   GET  /api/events                                the list of sessions, at once and again whenever it changes
//   POST /api/mode                    {mode}        every session's mode, those opened later included: ask, auto or
//                                                   yolo
//   GET  /api/providers                             {providers}: every provider of the catalog, the detected ones
//                                                   (a key in the environment, or a login) marked as such
//   GET  /api/providers/:id/models                  {models}: the provider's chat models
//   PUT  /api/providers/:id/key       {key}         stores the key in ~/.ji, as /login does: {providers}
//   DELETE /api/providers/:id/key                   forgets the stored key or login, as /logout does: {providers}
//
//   POST /api/endpoints               {id?, name, baseUrl, key?, models}  adds an OpenAI-compatible endpoint, or
//                                                   changes the one of id: {providers}
//   DELETE /api/endpoints/:id                       removes it and its key: {providers}
//   POST /api/endpoints/probe         {baseUrl, key?, id?}  {models}: the ids the server lists, asked with the key,
//                                                   or else the stored key of endpoint id
//
//   GET  /api/sessions                              {sessions, defaultRoot}, those the terminal made since included
//   POST /api/sessions                {root?, model?}  a new session, working in root (default: defaultRoot), on
//                                                   model, 'provider/id' (default: the service's --model)
//   POST /api/sessions/:id/archive    {archived}    out of the list's way, or back
//
//   GET  /api/sessions/:id/state                    a session's state, as in its 'state' event
//   GET  /api/sessions/:id/events                   its events: those after Last-Event-ID (or ?after=n), then each as
//                                                   it happens
//   POST /api/sessions/:id/messages   {text}        starts a reply, or steers the one in progress
//   POST /api/sessions/:id/commands   {line}        runs the command the line names, as the terminal does: {result:
//                                                   'ran'}, or a skill's sent as a message ('started' | 'steered')
//   POST /api/sessions/:id/questions/:q  {answers: string[][]} | {dismissed: true}
//   POST /api/sessions/:id/stop
//   POST /api/sessions/:id/mode       {mode?}       sets the session's mode; without one, switches between ask and
//                                                   auto
//   POST /api/sessions/:id/thinking   {level}
//   POST /api/sessions/:id/model      {model}       'provider/id': the model of the next reply, and of the session
//                                                   when it opens again; not while it replies
//
// An error is {error: message} with a 4xx status: 409 for a message sent while the terminal replies in the session.

import type { Reply } from '@ji.dev/plugin-choices'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { Mode } from '../features/permissions.ts'
import type { ServiceEvent } from './events.ts'
import type { EndpointInput } from './providers.ts'
import type { SessionHub, SessionSummary } from './sessions.ts'
import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'
import { models } from '@ji.dev/llm'
import { DISMISSED } from '@ji.dev/plugin-choices'
import { errorMessage } from '@ji.dev/utils'
import { SessionBusyError } from '../agent/conversation.ts'
import { MODES } from '../features/permissions.ts'
import {
  dropEndpoint,
  forgetKey,
  keepEndpoint,
  modelViews,
  probeEndpoint,
  providerViews,
  storeKey,
} from './providers.ts'
import { SessionNotFoundError } from './sessions.ts'

/** A comment line on an idle stream, so neither side takes the connection for dead. */
const HEARTBEAT_MS = 15_000

/** The most a request body may hold: a message is text, not a file. */
const MAX_BODY = 1_000_000

export interface AgentHttpOptions {
  hub: SessionHub
  /** Where a session is made when the client names no folder. */
  defaultRoot: string
  /** Where the endpoints are kept, ~/.ji; without it, none can be added. */
  auth?: string
}

export function createAgentHttpServer(options: AgentHttpOptions): Server {
  return createServer((req, res) => {
    route(options, req, res).catch((error: unknown) => {
      if (res.headersSent) {
        res.end()
        return
      }
      sendJson(res, statusOf(error), { error: errorMessage(error) })
    })
  })
}

async function route(
  { hub, defaultRoot, auth }: AgentHttpOptions,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const method = req.method ?? 'GET'
  const noRoute = (): HttpError => new HttpError(404, `no route for ${method} ${url.pathname}`)
  const [, api, collection, id, action, question] = url.pathname.split('/')
  if (api !== 'api') {
    throw noRoute()
  }

  if (collection === 'events' && method === 'GET') {
    return streamList(hub, defaultRoot, req, res)
  }
  if (collection === 'mode' && method === 'POST') {
    const mode = (await RequestBody.read(req)).mode()
    hub.setMode(mode)
    return sendJson(res, 200, { mode })
  }
  if (collection === 'providers') {
    return routeProviders({ method, id, action, noRoute }, auth, req, res)
  }
  if (collection === 'endpoints') {
    return routeEndpoints({ method, id, action, noRoute }, auth, req, res)
  }
  if (collection !== 'sessions') {
    throw noRoute()
  }

  if (id === undefined) {
    if (method === 'GET') {
      hub.refresh()
      return sendJson(res, 200, { sessions: hub.list(), defaultRoot })
    }
    const body = await RequestBody.read(req)
    return sendJson(res, 200, hub.create(body.stringOr('root', defaultRoot), body.optional('model')))
  }

  const sessionId = decodeURIComponent(id)
  if (method === 'GET' && action === 'state') {
    return sendJson(res, 200, hub.session(sessionId).state())
  }
  if (method === 'GET' && action === 'events') {
    const after = Number(req.headers['last-event-id'] ?? url.searchParams.get('after') ?? 0)
    return streamSession(hub, sessionId, Number.isFinite(after) ? after : 0, req, res)
  }
  if (method !== 'POST') {
    throw noRoute()
  }

  const body = await RequestBody.read(req)
  if (action === 'archive') {
    return sendJson(res, 200, hub.archive(sessionId, body.get('archived') !== false))
  }

  const service = hub.session(sessionId)
  switch (action) {
    case 'messages': {
      const text = body.string('text').trim()
      if (text === '') {
        throw new HttpError(400, 'the message is empty')
      }
      return sendJson(res, 200, { result: await service.send(text) })
    }
    case 'commands':
      return sendJson(res, 200, { result: await service.command(body.string('line').trim()) })
    case 'questions':
      if (question === undefined || !service.answer(decodeURIComponent(question), body.reply())) {
        throw new HttpError(404, `no question ${question} waits for an answer`)
      }
      return sendJson(res, 200, { ok: true })
    case 'stop':
      service.stop()
      return sendJson(res, 200, { ok: true })
    case 'mode':
      if (body.get('mode') === undefined) {
        service.switchMode()
      } else {
        service.setMode(body.mode())
      }
      return sendJson(res, 200, service.state())
    case 'thinking':
      service.think(body.string('level'))
      return sendJson(res, 200, service.state())
    case 'model':
      service.useModel(body.string('model'))
      return sendJson(res, 200, service.state())
    default:
      throw noRoute()
  }
}

/** A request's method, and its path's parts after /api/<collection>. */
interface Target {
  method: string
  id?: string
  action?: string
  noRoute: () => HttpError
}

/** /api/providers: the list, a provider's models, and its key stored or forgotten. */
async function routeProviders(
  { method, id, action, noRoute }: Target,
  auth: string | undefined,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (id === undefined && method === 'GET') {
    return sendProviders(res, auth)
  }

  const provider = decodeURIComponent(id ?? '')
  if (models.getProvider(provider) === undefined) {
    throw new HttpError(404, `no provider ${provider}`)
  }
  if (action === 'models' && method === 'GET') {
    return sendJson(res, 200, { models: modelViews(provider) })
  }
  if (action === 'key' && method === 'PUT') {
    await storeKey(provider, (await RequestBody.read(req)).string('key'))
    return sendProviders(res, auth)
  }
  if (action === 'key' && method === 'DELETE') {
    await forgetKey(provider)
    return sendProviders(res, auth)
  }
  throw noRoute()
}

/** /api/endpoints: one added, changed or removed, and the models a server lists. */
async function routeEndpoints(
  { method, id, noRoute }: Target,
  auth: string | undefined,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (auth === undefined) {
    throw new HttpError(404, 'this service keeps no endpoints')
  }
  if (method === 'DELETE' && id !== undefined) {
    await dropEndpoint(auth, decodeURIComponent(id))
    return sendProviders(res, auth)
  }
  if (method !== 'POST') {
    throw noRoute()
  }

  const body = await RequestBody.read(req)
  if (id === 'probe') {
    const found = await probeEndpoint(body.string('baseUrl'), body.optional('key'), body.optional('id'))
    return sendJson(res, 200, { models: found })
  }
  if (id !== undefined) {
    throw noRoute()
  }
  await keepEndpoint(auth, body.endpoint())
  return sendProviders(res, auth)
}

/** What a change of the providers answers with: all of them as it leaves them. */
async function sendProviders(res: ServerResponse, auth: string | undefined): Promise<void> {
  sendJson(res, 200, { providers: await providerViews(auth) })
}

/** The list, then the list again whenever it changes, until the client hangs up. */
function streamList(hub: SessionHub, defaultRoot: string, req: IncomingMessage, res: ServerResponse): void {
  const stream = new EventStream(res)
  const send = (sessions: SessionSummary[]): void => stream.send({ type: 'sessions', sessions, defaultRoot })

  send(hub.list())
  stream.keepOpen(req, hub.subscribe(send))
}

/** The events the client missed, then each as it happens, until it hangs up. */
function streamSession(hub: SessionHub, id: string, after: number, req: IncomingMessage, res: ServerResponse): void {
  const service = hub.session(id)
  const stream = new EventStream(res)
  const send = (e: ServiceEvent): void => stream.send(e, e.seq)

  service.eventsAfter(after).forEach(send)
  stream.keepOpen(req, service.subscribe(send))
}

class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function statusOf(error: unknown): number {
  if (error instanceof HttpError) {
    return error.status
  }
  if (error instanceof SessionNotFoundError) {
    return 404
  }
  if (error instanceof SessionBusyError) {
    return 409
  }
  return 400
}

/** A request's JSON body, its fields read as a route needs them: a body that is not an object has none. */
class RequestBody {
  private readonly fields: Record<string, unknown>

  private constructor(fields: Record<string, unknown>) {
    this.fields = fields
  }

  static async read(req: IncomingMessage): Promise<RequestBody> {
    let size = 0
    const chunks: Buffer[] = []
    for await (const chunk of req) {
      size += (chunk as Buffer).length
      if (size > MAX_BODY) {
        throw new HttpError(413, 'the request body is too large')
      }
      chunks.push(chunk as Buffer)
    }

    const text = Buffer.concat(chunks).toString('utf8')
    if (text.trim() === '') {
      return new RequestBody({})
    }

    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      throw new HttpError(400, 'the request body is not JSON')
    }

    return new RequestBody(isRecord(value) ? value : {})
  }

  get(name: string): unknown {
    return this.fields[name]
  }

  string(name: string): string {
    const value = this.fields[name]
    if (typeof value !== 'string') {
      throw new HttpError(400, `"${name}" must be a string`)
    }
    return value
  }

  /** The field when it is a string with something in it; `fallback` otherwise. */
  stringOr(name: string, fallback: string): string {
    return this.optional(name) ?? fallback
  }

  /** The field when it is a string with something in it. */
  optional(name: string): string | undefined {
    const value = this.fields[name]
    return typeof value === 'string' && value !== '' ? value : undefined
  }

  endpoint(): EndpointInput {
    const { models } = this.fields
    if (!Array.isArray(models) || !models.every(m => isRecord(m) && typeof m.id === 'string')) {
      throw new HttpError(400, '"models" must be a list of {id, contextWindow?, reasoning?}')
    }
    return {
      id: this.optional('id'),
      name: this.string('name'),
      baseUrl: this.string('baseUrl'),
      key: this.optional('key'),
      models: models.map(m => ({
        id: m.id as string,
        contextWindow: typeof m.contextWindow === 'number' ? m.contextWindow : undefined,
        reasoning: m.reasoning === true,
      })),
    }
  }

  mode(): Mode {
    const mode = MODES.find(m => m === this.fields.mode)
    if (mode === undefined) {
      throw new HttpError(400, '"mode" must be ask, auto or yolo')
    }
    return mode
  }

  reply(): Reply {
    if (this.fields.dismissed === true) {
      return DISMISSED
    }

    const { answers } = this.fields
    if (!Array.isArray(answers) || !answers.every(a => Array.isArray(a) && a.every(v => typeof v === 'string'))) {
      throw new HttpError(400, 'an answer is {answers: string[][]} or {dismissed: true}')
    }
    return answers as string[][]
  }
}

/** A Server-Sent Events response: open from the start, so a client knows it is connected with nothing to read yet. */
class EventStream {
  private readonly res: ServerResponse

  constructor(res: ServerResponse) {
    this.res = res
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    res.flushHeaders()
  }

  /** `id` is what the client sends back as Last-Event-ID when it connects again. */
  send(data: unknown, id?: number): void {
    const head = id === undefined ? '' : `id: ${id}\n`
    this.res.write(`${head}data: ${JSON.stringify(data)}\n\n`)
  }

  /** Beats while the client is connected; once it hangs up, stops what `unsubscribe` stops. */
  keepOpen(req: IncomingMessage, unsubscribe: () => void): void {
    const heartbeat = setInterval(() => this.res.write(': ping\n\n'), HEARTBEAT_MS)
    req.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
    })
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}
