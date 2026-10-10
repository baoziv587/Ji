// Every session the server keeps, each in a folder of its own, any number replying at once. A session is opened, read
// back from its log, the first time a client asks for it; until then it is only its line in the list.
//
//   list      every session, with what each is doing: what a sidebar shows
//   create    a new session working in a folder
//   session   one session's service, opened if need be
//   archive   out of the list's way, or back in it: nothing is deleted

import type { AgentService } from './service.ts'
import type { SessionMeta, SessionStore } from './store.ts'
import { statSync } from 'node:fs'
import { resolve } from 'node:path'

/** idle, replying, waiting for an answer, or its last reply failed. */
export type SessionStatus = 'idle' | 'running' | 'asking' | 'failed'

export interface SessionSummary extends SessionMeta {
  status: SessionStatus
}

export interface SessionHubOptions {
  store: SessionStore
  /** The session's service, its tools working in its root, its log written to the store. */
  open: (meta: SessionMeta) => AgentService
}

export interface SessionHub {
  /** Most recently used first. */
  list: () => SessionSummary[]
  /** Throws when `root` is not a folder. */
  create: (root: string) => SessionSummary
  /** Throws SessionNotFoundError for an id no session has. */
  session: (id: string) => AgentService
  /** Throws while the session is replying: stop it first. */
  archive: (id: string, archived: boolean) => SessionSummary
  /** Called with the list whenever a session is added, archived, or starts or stops doing something. */
  subscribe: (listener: (sessions: SessionSummary[]) => void) => () => void
  /** Stops every reply and closes the logs. */
  close: () => Promise<void>
}

export class SessionNotFoundError extends Error {
  constructor(id: string) {
    super(`no session ${id}`)
    this.name = 'SessionNotFoundError'
  }
}

/** A title is the first line of the first message, this long at most. */
const TITLE_LENGTH = 80

export function createSessionHub({ store, open }: SessionHubOptions): SessionHub {
  const metas = new Map(store.list().map(meta => [meta.id, meta]))
  const opened = new Map<string, AgentService>()
  const listeners = new Set<(sessions: SessionSummary[]) => void>()

  const statusOf = (id: string): SessionStatus => {
    const service = opened.get(id)
    if (service === undefined) {
      return 'idle'
    }
    const { asking, replying, outcome } = service.state()
    if (asking.length > 0) {
      return 'asking'
    }
    if (replying) {
      return 'running'
    }
    return outcome === 'failed' ? 'failed' : 'idle'
  }

  const summaryOf = (meta: SessionMeta): SessionSummary => ({ ...meta, status: statusOf(meta.id) })

  const list = (): SessionSummary[] => [...metas.values()].sort((a, b) => b.updated - a.updated).map(summaryOf)

  const changed = (): void => {
    const sessions = list()
    for (const listener of listeners) {
      listener(sessions)
    }
  }

  const metaOf = (id: string): SessionMeta => {
    const meta = metas.get(id)
    if (meta === undefined) {
      throw new SessionNotFoundError(id)
    }
    return meta
  }

  const update = (meta: SessionMeta, patch: Partial<SessionMeta>): SessionMeta => {
    const next = { ...meta, ...patch }
    metas.set(next.id, next)
    store.save(next)
    return next
  }

  const session = (id: string): AgentService => {
    const existing = opened.get(id)
    if (existing !== undefined) {
      return existing
    }

    const service = open(metaOf(id))
    opened.set(id, service)
    service.subscribe(e => {
      if (e.type === 'user') {
        const meta = metaOf(id)
        const title = meta.title === '' ? titleOf(e.text) : meta.title
        update(meta, { title, updated: Date.now() })
      }
      if (e.type === 'state' || e.type === 'user' || e.type === 'reply_end') {
        changed()
      }
    })
    return service
  }

  return {
    list,
    create: folder => {
      const root = resolve(folder)
      if (!isFolder(root)) {
        throw new Error(`${root} is not a folder`)
      }
      const meta = store.create(root)
      metas.set(meta.id, meta)
      changed()
      return summaryOf(meta)
    },
    session,
    archive: (id, archived) => {
      if (opened.get(id)?.state().replying === true) {
        throw new Error('the session is replying: stop it before archiving it')
      }
      const meta = update(metaOf(id), { archived })
      changed()
      return summaryOf(meta)
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    close: async () => {
      for (const service of opened.values()) {
        service.stop()
      }
      await Promise.all([...opened.values()].map(service => service.settled()))
      store.close()
    },
  }
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
