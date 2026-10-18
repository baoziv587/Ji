// Every session the server keeps, each in a folder of its own, any number replying at once. A session is opened, read
// back from its log, the first time a client asks for it; until then it is only its line in the list.
//
//   list      every session, with what each is doing: what a sidebar shows
//   create    a new session working in a folder, on a model of its own or the default, with the environment of the
//             terminal that made it
//   session   one session's service, opened if need be
//   archive   out of the list's way, or back in it: nothing is deleted
//   setMode   what waits for a yes in every session, those opened later included

import type { Mode } from '../features/permissions.ts'
import type { ServiceState } from './events.ts'
import type { AgentService } from './service.ts'
import type { SessionMeta, SessionStore } from './store.ts'
import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import { findModel } from '@ji.dev/llm'

/** idle, replying, waiting for an answer, or its last reply failed. */
type SessionStatus = 'idle' | 'running' | 'asking' | 'failed'

export interface SessionSummary extends SessionMeta {
  status: SessionStatus
}

/** The variables a session's commands run with: the terminal's that made it. */
export type Environment = Readonly<Record<string, string | undefined>>

/** Opens a session's service: its tools working in its root, with `env` when given, its log written to the store. */
export interface Opener {
  open: (meta: SessionMeta, mode: Mode, env?: Environment) => AgentService
}

export interface SessionHubOptions {
  store: SessionStore
  opener: Opener
  /** The mode a session opens in until setMode: ask by default. */
  mode?: Mode
}

export class SessionNotFoundError extends Error {
  constructor(id: string) {
    super(`no session ${id}`)
    this.name = 'SessionNotFoundError'
  }
}

/** A title is the first line of the first message, this long at most. */
const TITLE_LENGTH = 80

export class SessionHub {
  private readonly store: SessionStore
  private readonly opener: Opener
  private mode: Mode
  private readonly metas: Map<string, SessionMeta>
  private readonly opened = new Map<string, AgentService>()
  /** The environments sessions were made with, until they open: kept in memory only, as they hold keys. */
  private readonly envs = new Map<string, Environment>()
  private readonly listeners = new Set<(sessions: SessionSummary[]) => void>()

  constructor({ store, opener, mode = 'ask' }: SessionHubOptions) {
    this.store = store
    this.opener = opener
    this.mode = mode
    this.metas = new Map(store.list().map(meta => [meta.id, meta]))
  }

  /** Most recently used first. */
  list(): SessionSummary[] {
    return [...this.metas.values()].sort((a, b) => b.updated - a.updated).map(meta => this.summaryOf(meta))
  }

  /**
   * `model` is 'provider/id', or a bare id one provider offers; without it, the session opens on the opener's default.
   * `env` is what its commands run with: this process's without it. Throws when `folder` is not a folder, and
   * UnknownModelError when the catalog has no such model.
   */
  create(folder: string, model?: string, env?: Environment): SessionSummary {
    const root = resolve(folder)
    if (!isFolder(root)) {
      throw new Error(`${root} is not a folder`)
    }

    const meta = this.store.create(root, model === undefined ? undefined : specOf(model))
    this.metas.set(meta.id, meta)
    if (env !== undefined) {
      this.envs.set(meta.id, env)
    }
    this.changed()
    return this.summaryOf(meta)
  }

  /** The session's service, opened if need be. Throws SessionNotFoundError for an id no session has. */
  session(id: string): AgentService {
    const existing = this.opened.get(id)
    if (existing !== undefined) {
      return existing
    }

    const service = this.opener.open(this.metaOf(id), this.mode, this.envs.get(id))
    this.envs.delete(id)
    this.opened.set(id, service)
    service.subscribe(e => {
      if (e.type === 'user') {
        this.used(id, e.text)
      }
      if (e.type === 'state' && e.state.model !== this.metaOf(id).model) {
        this.update(this.metaOf(id), { model: e.state.model })
      }
      if (e.type === 'state' || e.type === 'user' || e.type === 'reply_end') {
        this.changed()
      }
    })
    return service
  }

  /** Throws while the session is replying: stop it first. */
  archive(id: string, archived: boolean): SessionSummary {
    if (this.opened.get(id)?.replying === true) {
      throw new Error('the session is replying: stop it before archiving it')
    }

    const meta = this.update(this.metaOf(id), { archived })
    this.changed()
    return this.summaryOf(meta)
  }

  /** Every session's mode, and the one the sessions opened from now on start in. */
  setMode(mode: Mode): void {
    this.mode = mode
    for (const service of this.opened.values()) {
      service.setMode(mode)
    }
  }

  /** Whether any session is replying now. */
  replying(): boolean {
    return [...this.opened.values()].some(service => service.replying)
  }

  /** Called with the list whenever a session is added, archived, or starts or stops doing something. */
  subscribe(listener: (sessions: SessionSummary[]) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Stops every reply and closes the logs. */
  async close(): Promise<void> {
    const services = [...this.opened.values()]
    for (const service of services) {
      service.stop()
    }
    await Promise.all(services.map(service => service.settled()))
    this.store.close()
  }

  private summaryOf(meta: SessionMeta): SessionSummary {
    return { ...meta, status: statusOf(this.opened.get(meta.id)?.state()) }
  }

  private changed(): void {
    if (this.listeners.size === 0) {
      return
    }
    const sessions = this.list()
    for (const listener of this.listeners) {
      listener(sessions)
    }
  }

  private metaOf(id: string): SessionMeta {
    const meta = this.metas.get(id)
    if (meta === undefined) {
      throw new SessionNotFoundError(id)
    }
    return meta
  }

  /** A message was sent: the session moves to the top, titled by it if it was the first. */
  private used(id: string, text: string): void {
    const meta = this.metaOf(id)
    const title = meta.title === '' ? titleOf(text) : meta.title
    this.update(meta, { title, updated: Date.now() })
  }

  private update(meta: SessionMeta, patch: Partial<SessionMeta>): SessionMeta {
    const next = { ...meta, ...patch }
    this.metas.set(next.id, next)
    this.store.save(next)
    return next
  }
}

/** What a session is doing, from its state; idle until it is opened. */
function statusOf(state: ServiceState | undefined): SessionStatus {
  if (state === undefined) {
    return 'idle'
  }
  if (state.asking.length > 0) {
    return 'asking'
  }
  if (state.replying) {
    return 'running'
  }
  return state.outcome === 'failed' ? 'failed' : 'idle'
}

function titleOf(text: string): string {
  const line = text.trim().split('\n')[0] ?? ''
  return line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH - 1)}…` : line
}

function isFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** The model as 'provider/id', a bare id included; throws UnknownModelError when the catalog has no such model. */
function specOf(model: string): string {
  const { provider, id } = findModel(model)
  return `${provider}/${id}`
}
