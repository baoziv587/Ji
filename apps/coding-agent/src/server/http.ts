// The sessions over HTTP: JSON for what a client asks and does, and Server-Sent Events for what happens, so a client
// needs nothing but an HTTP library.
//
//   GET  /api/events                                the list of sessions, at once and again whenever it changes
//   POST /api/mode                    {mode}        every session's mode, those opened later included: ask, auto or
//                                                   yolo
//   GET  /api/sessions                              {sessions, defaultRoot}
//   POST /api/sessions                {root?}       a new session, working in root (default: defaultRoot)
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
//
// An error is {error: message} with a 4xx status.

import type { Reply } from '@ji.dev/plugin-choices'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { Mode } from '../features/permissions.ts'
import type { ServiceEvent } from './events.ts'
import type { SessionHub, SessionSummary } from './sessions.ts'
import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'
import { DISMISSED } from '@ji.dev/plugin-choices'
import { errorMessage } from '@ji.dev/utils'
import { MODES } from '../features/permissions.ts'
import { SessionNotFoundError } from './sessions.ts'

/** A comment line on an idle stream, so neither side takes the connection for dead. */
const HEARTBEAT_MS = 15_000

/** The most a request body may hold: a message is text, not a file. */
const MAX_BODY = 1_000_000

export interface AgentHttpOptions {
  hub: SessionHub
  /** Where a session is made when the client names no folder. */
  defaultRoot: string
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

async function route({ hub, defaultRoot }: AgentHttpOptions, req: IncomingMessage, res: ServerResponse): Promise<void> {
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
  if (collection !== 'sessions') {
    throw noRoute()
  }

  if (id === undefined) {
    if (method === 'GET') {
      return sendJson(res, 200, { sessions: hub.list(), defaultRoot })
    }
    const body = await RequestBody.read(req)
    return sendJson(res, 200, hub.create(body.stringOr('root', defaultRoot)))
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
    default:
      throw noRoute()
  }
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
    const value = this.fields[name]
    return typeof value === 'string' && value !== '' ? value : fallback
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
