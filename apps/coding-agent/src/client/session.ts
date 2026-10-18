// The terminal's side of a session of the service (server/http.ts): what it does, as requests, and what happens, as
// the session's event stream with the run events whole, read again from where it broke off when the connection drops.

import type { Reply } from '@ji.dev/plugin-choices'
import type { Mode } from '../features/permissions.ts'
import type { LiveEvent, ServiceEvent, ServiceState } from '../server/events.ts'
import type { Environment, SessionSummary } from '../server/sessions.ts'
import { setTimeout as sleep } from 'node:timers/promises'
import { DISMISSED } from '@ji.dev/plugin-choices'

/** What the stream carries: the session's events, and its run events as they happen. */
export type ClientEvent = ServiceEvent | { type: 'run'; event: LiveEvent }

export interface NewSession {
  root: string
  /** 'provider/id'. */
  model: string
  /** What its commands run with: the terminal's. */
  env: Environment
}

/** What the stream tells besides its events: that it broke off, and that it is back. */
export interface StreamNews {
  dropped: (error: unknown) => void
  restored: () => void
}

/** How long a dropped stream waits before connecting again. */
const RECONNECT_MS = 1000

export class SessionClient {
  readonly id: string
  private readonly url: string

  private constructor(base: string, id: string) {
    this.id = id
    this.url = `${base}/api/sessions/${encodeURIComponent(id)}`
  }

  /** A new session of the service at `base`; throws with the service's reason, an unknown model's say. */
  static async create(base: string, session: NewSession): Promise<SessionClient> {
    const { id } = await request<SessionSummary>(`${base}/api/sessions`, 'POST', session)
    return new SessionClient(base, id)
  }

  /** Throws when the model has no key. */
  async send(text: string): Promise<'started' | 'steered'> {
    return (await this.post<{ result: 'started' | 'steered' }>('messages', { text })).result
  }

  /** A line that names a command; one only the model knows, a skill's, goes as a message. */
  async command(line: string): Promise<'ran' | 'started' | 'steered'> {
    return (await this.post<{ result: 'ran' | 'started' | 'steered' }>('commands', { line })).result
  }

  async answer(question: string, reply: Reply): Promise<void> {
    const body = reply === DISMISSED ? { dismissed: true } : { answers: reply }
    await this.post(`questions/${encodeURIComponent(question)}`, body)
  }

  async stop(): Promise<void> {
    await this.post('stop')
  }

  /** Sets the mode; without one, switches between ask and auto. */
  setMode(mode?: Mode): Promise<ServiceState> {
    return this.post('mode', mode === undefined ? {} : { mode })
  }

  /** Throws on a level the model does not take. */
  think(level: string): Promise<ServiceState> {
    return this.post('thinking', { level })
  }

  /**
   * Reads every event from the first, then each as it happens, until `signal` aborts: after a drop, again from the
   * last one read.
   */
  async listen(take: (e: ClientEvent) => void, signal: AbortSignal, news: StreamNews): Promise<void> {
    let after = 0
    let dropped = false
    while (!signal.aborted) {
      try {
        await readStream(`${this.url}/events?run=1`, after, signal, (e, id) => {
          if (dropped) {
            dropped = false
            news.restored()
          }
          after = id ?? after
          take(e)
        })
      } catch (error) {
        if (signal.aborted) {
          return
        }
        if (!dropped) {
          dropped = true
          news.dropped(error)
        }
      }
      await sleep(RECONNECT_MS, undefined, { signal }).catch(() => {})
    }
  }

  private post<T>(action: string, body: unknown = {}): Promise<T> {
    return request<T>(`${this.url}/${action}`, 'POST', body)
  }
}

/** The JSON a request answers with; throws with the service's reason when it refuses, or when nothing answers. */
async function request<T>(url: string, method: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new Error(`The service at ${new URL(url).origin} is not answering.`)
  }

  const json = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok) {
    throw new Error(json.error ?? `${method} ${url}: ${response.status}`)
  }
  return json as T
}

/** Reads a stream of Server-Sent Events after the one numbered `after`, each to `take` with its number, if it has one. */
async function readStream(
  url: string,
  after: number,
  signal: AbortSignal,
  take: (e: ClientEvent, id: number | undefined) => void,
): Promise<void> {
  const response = await fetch(url, { headers: after > 0 ? { 'last-event-id': String(after) } : {}, signal })
  if (!response.ok || response.body === null) {
    throw new Error(`${url}: ${response.status}`)
  }

  let buffer = ''
  for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
    buffer += chunk
    // Every whole message in it, then what is left is cut off once: a stream read again from the first holds many
    let start = 0
    for (let end = buffer.indexOf('\n\n'); end !== -1; end = buffer.indexOf('\n\n', start)) {
      const message = parseMessage(buffer.slice(start, end))
      if (message !== undefined) {
        take(message.data, message.id)
      }
      start = end + 2
    }
    buffer = buffer.slice(start)
  }
  throw new Error('the service closed the stream')
}

/** A message's data and id; none for a comment, a heartbeat's. */
function parseMessage(block: string): { data: ClientEvent; id?: number } | undefined {
  let data: string | undefined
  let id: number | undefined
  for (const line of block.split('\n')) {
    if (line.startsWith('data: ')) {
      data = line.slice('data: '.length)
    } else if (line.startsWith('id: ')) {
      id = Number(line.slice('id: '.length))
    }
  }
  return data === undefined ? undefined : { data: JSON.parse(data) as ClientEvent, id }
}
