// The terminal's conversation kept where the service keeps its sessions (~/.ji/sessions), so the desktop app lists it
// and can go on with it. Its line is written with the first message; each reply takes the session's lock, and while
// the desktop app writes one, a message waits in the input until it ends, then the terminal shows what it wrote and
// goes on from it.

import type { AgentState } from '@ji.dev/llm'
import type { ReplyLock } from '../agent/conversation.ts'
import type { LogRecord } from '../server/history.ts'
import type { SessionStore } from '../server/store.ts'
import { setTimeout as sleep } from 'node:timers/promises'
import { log } from '@clack/prompts'
import { dimText } from '@ji.dev/tui'
import { clientEventOf, historyOf } from '../server/history.ts'

/** How often the lock is looked at while the desktop app replies. */
const POLL_MS = 500

export interface SharedSessionOptions {
  store: SessionStore
  /** Where the session works: the terminal's root. */
  root: string
  /** The conversation's id, and its model as 'provider/id'. */
  id: () => string
  model: () => string
}

export class SharedSession implements ReplyLock {
  private readonly options: SharedSessionOptions

  constructor(options: SharedSessionOptions) {
    this.options = options
  }

  readonly claim = (): AgentState | undefined => {
    const { store, root, model } = this.options
    const id = this.options.id()
    store.lock(id)
    if (store.meta(id) === undefined) {
      store.create(root, model(), id)
      return undefined
    }
    return this.catchUp()
  }

  readonly release = (): void => {
    this.options.store.unlock(this.options.id())
  }

  /** A message was sent: the session's title, when it is the first, and when it was last used. */
  used(text: string): void {
    this.options.store.used(this.options.id(), text, this.options.model())
  }

  /** Resolves once the desktop app's reply has ended, with the history it left; none when it wrote nothing. */
  async whenFree(): Promise<AgentState | undefined> {
    const { store, id } = this.options
    while (store.holder(id()) !== undefined) {
      await sleep(POLL_MS)
    }
    return this.catchUp()
  }

  /** What the desktop app wrote since, shown, and the history it left; none when it wrote nothing. */
  private catchUp(): AgentState | undefined {
    const { store, id } = this.options
    const unread = store.unread(id())
    if (unread.length === 0) {
      return undefined
    }
    showWritten(unread)
    return historyOf(store.records(id())).state
  }
}

/** The messages and the replies the desktop app wrote, as plain lines: the tools it ran are left out. */
function showWritten(records: readonly LogRecord[]): void {
  let reply = ''
  const flush = (): void => {
    if (reply.trim() !== '') {
      log.message(reply.trim(), { spacing: 0 })
    }
    reply = ''
  }

  for (const record of records) {
    const event = clientEventOf(record)
    if (event?.type === 'user') {
      flush()
      log.message(`${dimText('Desktop app ›')} ${event.text}`)
    } else if (event?.type === 'text') {
      reply += event.delta
    } else if (event?.type === 'reply_end') {
      flush()
    }
  }
  flush()
}
