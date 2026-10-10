// The sessions over HTTP: JSON for what a client asks and does, and Server-Sent Events for what happens, so a client
// needs nothing but an HTTP library.
//
//   GET  /api/events                                the list of sessions, at once and again whenever it changes
//   GET  /api/sessions                              {sessions, defaultRoot}
//   POST /api/sessions                {root?}       a new session, working in root (default: defaultRoot)
//   POST /api/sessions/:id/archive    {archived}    out of the list's way, or back
//
//   GET  /api/sessions/:id/state                    a session's state, as in its 'state' event
//   GET  /api/sessions/:id/events                   its events: those after Last-Event-ID (or ?after=n), then each as
//                                                   it happens
//   POST /api/sessions/:id/messages   {text}        starts a reply, or steers the one in progress
//   POST /api/sessions/:id/questions/:q  {answers: string[][]} | {dismissed: true}
//   POST /api/sessions/:id/stop
//   POST /api/sessions/:id/mode                     switches between ask and auto
//   POST /api/sessions/:id/thinking   {level}
//
// An error is {error: message} with a 4xx status.

import type { Reply } from '@ji.dev/plugin-choices'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { ServiceEvent } from './events.ts'
import type { SessionHub, SessionSummary } from './sessions.ts'
import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'
import { DISMISSED } from '@ji.dev/plugin-choices'
import { SessionNotFoundError } from './sessions.ts'

/** A comment line on an idle stream, so neither side takes the connection for dead. */
const HEARTBEAT_MS = 15_000

/** The most a request body may hold: a message is text, not a file. */
const MAX_BODY = 1_000_000

class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export interface AgentHttpOptions {
  hub: SessionHub
  /** Where a session is made when the client names no folder. */
  defaultRoot: string
}

export function createAgentHttpServer(options: AgentHttpOptions): Server {
  return createServer((req, res) => {
    route(options, req, res).catch((error: unknown) => {
      const status = error instanceof HttpError ? error.status : error instanceof SessionNotFoundError ? 404 : 400
      if (res.headersSent) {
        res.end()
        return
      }
      sendJson(res, status, { error: error instanceof Error ? error.message : String(error) })
    })
  })
}

async function route({ hub, defaultRoot }: AgentHttpOptions, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const method = req.method ?? 'GET'
  const [, api, collection, id, action, question] = url.pathname.split('/')
  if (api !== 'api') {
    throw new HttpError(404, `no route for ${method} ${url.pathname}`)
  }

  if (collection === 'events' && method === 'GET') {
    return streamList(hub, defaultRoot, req, res)
  }
  if (collection !== 'sessions') {
    throw new HttpError(404, `no route for ${method} ${url.pathname}`)
  }

  if (id === undefined) {
    if (method === 'GET') {
      return sendJson(res, 200, { sessions: hub.list(), defaultRoot })
    }
    const body = await readJson(req)
    const root = isRecord(body) && typeof body.root === 'string' && body.root !== '' ? body.root : defaultRoot
    return sendJson(res, 200, hub.create(root))
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
    throw new HttpError(404, `no route for ${method} ${url.pathname}`)
  }

  const body = await readJson(req)
  if (action === 'archive') {
    return sendJson(res, 200, hub.archive(sessionId, isRecord(body) ? body.archived !== false : true))
  }

  const service = hub.session(sessionId)
  switch (action) {
    case 'messages': {
      const text = stringField(body, 'text').trim()
      if (text === '') {
        throw new HttpError(400, 'the message is empty')
      }
      return sendJson(res, 200, { result: await service.send(text) })
    }
    case 'questions':
      if (question === undefined || !service.answer(decodeURIComponent(question), replyOf(body))) {
        throw new HttpError(404, `no question ${question} waits for an answer`)
      }
      return sendJson(res, 200, { ok: true })
    case 'stop':
      service.stop()
      return sendJson(res, 200, { ok: true })
    case 'mode':
      service.switchMode()
      return sendJson(res, 200, service.state())
    case 'thinking':
      service.think(stringField(body, 'level'))
      return sendJson(res, 200, service.state())
    default:
      throw new HttpError(404, `no route for ${method} ${url.pathname}`)
  }
}

/** The list, then the list again whenever it changes, until the client hangs up. */
function streamList(hub: SessionHub, defaultRoot: string, req: IncomingMessage, res: ServerResponse): void {
  const write = (sessions: SessionSummary[]): void => {
    res.write(`data: ${JSON.stringify({ type: 'sessions', sessions, defaultRoot })}\n\n`)
  }
  openStream(res)
  write(hub.list())
  keepOpen(req, res, hub.subscribe(write))
}

/** The events the client missed, then each as it happens, until it hangs up. */
function streamSession(hub: SessionHub, id: string, after: number, req: IncomingMessage, res: ServerResponse): void {
  const service = hub.session(id)
  const write = (e: ServiceEvent): void => {
    res.write(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`)
  }
  openStream(res)
  service.eventsAfter(after).forEach(write)
  keepOpen(req, res, service.subscribe(write))
}

function openStream(res: ServerResponse): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  // Sent before any event, so a client knows it is connected even with nothing to read yet
  res.flushHeaders()
}

function keepOpen(req: IncomingMessage, res: ServerResponse, unsubscribe: () => void): void {
  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS)
  req.on('close', () => {
    clearInterval(heartbeat)
    unsubscribe()
  })
}

function replyOf(body: unknown): Reply {
  if (isRecord(body) && body.dismissed === true) {
    return DISMISSED
  }
  const answers = isRecord(body) ? body.answers : undefined
  if (!Array.isArray(answers) || !answers.every(a => Array.isArray(a) && a.every(v => typeof v === 'string'))) {
    throw new HttpError(400, 'an answer is {answers: string[][]} or {dismissed: true}')
  }
  return answers as string[][]
}

async function readJson(req: IncomingMessage): Promise<unknown> {
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
    return {}
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new HttpError(400, 'the request body is not JSON')
  }
}

function stringField(body: unknown, name: string): string {
  const value = isRecord(body) ? body[name] : undefined
  if (typeof value !== 'string') {
    throw new HttpError(400, `"${name}" must be a string`)
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}
