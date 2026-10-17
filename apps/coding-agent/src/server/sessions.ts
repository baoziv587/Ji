// Every session the server keeps, each in a folder of its own, any number replying at once. A session is opened, read
// back from its log, the first time a client asks for it; until then it is only its line in the list.
//
//   list      every session, with what each is doing: what a sidebar shows
//   create    a new session working in a folder, on a model of its own or the default
//   session   one session's service, opened if need be
//   archive   out of the list's way, or back in it: nothing is deleted
//   setMode   what waits for a yes in every session, those opened later included
//   refresh   what the terminal changed in the folder: sessions it made, and the replies it writes

import type { Writer } from '../agent/conversation.ts'
import type { Mode } from '../features/permissions.ts'
import type { ServiceState } from './events.ts'
import type { AgentService } from './service.ts'
import type { SessionLock, SessionMeta, SessionStore } from './store.ts'
import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import { findModel } from '@ji.dev/llm'

/** idle, replying, waiting for an answer, or its last reply failed. */
type SessionStatus = 'idle' | 'running' | 'asking' | 'failed'

export interface SessionSummary extends SessionMeta {
  status: SessionStatus
  /** Another process writes a reply to it now: the terminal. */
  heldBy?: Writer
}

/** Opens a session's service: its tools working in its root, its log written to the store. */
export interface Opener {
  open: (meta: SessionMeta, mode: Mode) => AgentService
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

export class SessionHub {
  private readonly store: SessionStore
  private readonly opener: Opener
  private mode: Mode
  private readonly metas: Map<string, SessionMeta>
  private readonly opened = new Map<string, AgentService>()
  /** The sessions another process writes a reply to, as of the last refresh. */
  private held = new Map<string, SessionLock>()
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
   * Throws when `folder` is not a folder, and UnknownModelError when the catalog has no such model.
   */
  create(folder: string, model?: string): SessionSummary {
    const root = resolve(folder)
    if (!isFolder(root)) {
      throw new Error(`${root} is not a folder`)
    }

    const meta = this.store.create(root, model === undefined ? undefined : specOf(model))
    this.metas.set(meta.id, meta)
    this.changed()
    return this.summaryOf(meta)
  }

  /** The session's service, opened if need be. Throws SessionNotFoundError for an id no session has. */
  session(id: string): AgentService {
    const existing = this.opened.get(id)
    if (existing !== undefined) {
      return existing
    }

    const service = this.opener.open(this.metaOf(id), this.mode)
    this.opened.set(id, service)
    service.setHeldBy(this.held.get(id)?.by)
    service.subscribe(e => {
      // The terminal's messages it titled itself
      if (e.type === 'user' && service.state().replying) {
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
    if (this.opened.get(id)?.state().replying === true) {
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

  /**
   * Reads what another process changed in the folder since: the sessions it made, the lines of those it writes to, and
   * what it appended to the logs of those open here. Cheap when nothing changed: one read of the folder, and one of
   * each open log's size.
   */
  refresh(): void {
    const { sessions, locked } = this.store.listing()
    let changed = false
    for (const id of sessions) {
      if (!this.metas.has(id)) {
        const meta = this.store.meta(id)
        if (meta !== undefined) {
          this.metas.set(id, meta)
          changed = true
        }
      }
    }

    const held = new Map<string, SessionLock>()
    for (const id of locked) {
      const lock = this.store.holder(id)
      if (lock !== undefined) {
        held.set(id, lock)
      }
    }
    // Written to elsewhere now, or until now: its line again, a title or a time changed
    for (const id of new Set([...held.keys(), ...this.held.keys()])) {
      const meta = this.store.meta(id)
      const was = this.metas.get(id)
      if (meta !== undefined && (meta.title !== was?.title || meta.updated !== was.updated)) {
        this.metas.set(id, meta)
        changed = true
      }
      changed ||= held.get(id)?.pid !== this.held.get(id)?.pid
    }
    this.held = held

    for (const [id, service] of this.opened) {
      service.written(this.store.unread(id))
      service.setHeldBy(held.get(id)?.by)
    }
    if (changed) {
      this.changed()
    }
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
    return { ...meta, status: statusOf(this.opened.get(meta.id)?.state()), heldBy: this.held.get(meta.id)?.by }
  }

  private changed(): void {
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
    const meta = this.store.used(id, text)
    if (meta !== undefined) {
      this.metas.set(id, meta)
    }
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
