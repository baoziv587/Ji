// The sessions on disk, two files each in one folder (~/.ji/sessions by default):
//
//   <id>.json    what the list shows: the folder it works in, its title, when it was made and last used, archived,
//                and the model it runs on
//   <id>.jsonl   its log, one run event a line, as @ji.dev/plugin-jsonl writes it: what it is read back from
//   <id>.lock    while a reply is written to it: who writes it, the terminal or the service, so the other waits
//
// The terminal and the service share the folder: each takes the lock for a reply, and reads what the other appended
// to a log (unread) before it goes on from it. Nothing is ever deleted: an archived session keeps both files.

import type { Writer } from '../agent/conversation.ts'
import type { LogRecord } from './history.ts'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import {
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { compact } from '@ji.dev/plugin-jsonl'
import { watch } from 'chokidar'
import { SessionBusyError } from '../agent/conversation.ts'

export interface SessionMeta {
  id: string
  /** Where its files are and its commands run. */
  root: string
  /** Its first message, cut short; empty until one is sent. */
  title: string
  /** Milliseconds since the epoch. */
  created: number
  updated: number
  archived: boolean
  /** 'provider/id' it runs on, switched to or the default when it opened: it opens on it again. */
  model?: string
}

/** What a lock file holds. */
export interface SessionLock {
  by: Writer
  pid: number
  /** Milliseconds since the epoch. */
  started: number
}

/** The session ids of the folder: those with a line in the list, and those a reply is written to now. */
export interface StoreListing {
  sessions: string[]
  locked: string[]
}

/** A title is the first line of the first message, this long at most. */
const TITLE_LENGTH = 80

/** How long watch waits after a write for the ones that follow it, before it calls back once for them all. */
const SETTLE_MS = 100

export class SessionStore {
  private readonly dir: string
  private readonly writer: Writer
  /** The logs open for appending, by session id. */
  private readonly logs = new Map<string, number>()
  /** How far each log has been read or written by this process, in bytes. */
  private readonly offsets = new Map<string, number>()

  /** `dir` is made if it is not there; `writer` is who this process is in the locks it takes. */
  constructor(dir: string, writer: Writer = 'desktop') {
    this.dir = dir
    this.writer = writer
    mkdirSync(dir, { recursive: true })
  }

  list(): SessionMeta[] {
    return this.listing().sessions.flatMap(id => this.meta(id) ?? [])
  }

  /** One read of the folder. */
  listing(): StoreListing {
    const names = readdirSync(this.dir)
    const idsOf = (ext: string): string[] => names.filter(n => n.endsWith(ext)).map(n => n.slice(0, -ext.length))
    return { sessions: idsOf('.json'), locked: idsOf('.lock') }
  }

  /** The session's line, as the folder has it now; none when there is none, or it does not parse. */
  meta(id: string): SessionMeta | undefined {
    try {
      return JSON.parse(readFileSync(this.metaPath(id), 'utf8')) as SessionMeta
    } catch {
      return undefined
    }
  }

  /** `id` is the conversation's own, when it has one already: the terminal's. */
  create(root: string, model?: string, id: string = randomUUID()): SessionMeta {
    const now = Date.now()
    const meta: SessionMeta = { id, root, title: '', created: now, updated: now, archived: false, model }
    this.save(meta)
    return meta
  }

  save(meta: SessionMeta): void {
    writeFileSync(this.metaPath(meta.id), `${JSON.stringify(meta, null, 2)}\n`)
  }

  /**
   * The session's log, read back with its deltas joined; a line that does not parse (cut short by a crash, say) is
   * skipped. What is read counts as read: unread starts after it.
   */
  records(id: string): LogRecord[] {
    return this.readFrom(id, 0, true)
  }

  /**
   * What another process appended to the session's log since this one last read or wrote it, its whole lines only:
   * the replies the terminal wrote to a session the service has open, say.
   */
  unread(id: string): LogRecord[] {
    const from = this.offsets.get(id)
    return from === undefined ? [] : this.readFrom(id, from, false)
  }

  /** Appends a line to the session's log. */
  append(id: string, line: string): void {
    let fd = this.logs.get(id)
    if (fd === undefined) {
      fd = openSync(this.logPath(id), 'a')
      this.logs.set(id, fd)
    }
    const text = `${line}\n`
    writeSync(fd, text)
    this.offsets.set(id, (this.offsets.get(id) ?? 0) + Buffer.byteLength(text))
  }

  /**
   * Takes the session for a reply, or throws SessionBusyError while another process writes one. A lock left by a
   * process that is gone is taken over.
   */
  lock(id: string): void {
    const path = this.lockPath(id)
    const mine: SessionLock = { by: this.writer, pid: process.pid, started: Date.now() }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        writeFileSync(path, JSON.stringify(mine), { flag: 'wx' })
        return
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw error
        }
      }
      const held = readLock(path)
      if (held?.pid === process.pid) {
        return
      }
      if (held !== undefined && isAlive(held.pid)) {
        throw new SessionBusyError(held.by)
      }
      rmSync(path, { force: true })
    }
    const held = this.holder(id)
    if (held !== undefined) {
      throw new SessionBusyError(held.by)
    }
  }

  /** Gives the session back, when this process has it. */
  unlock(id: string): void {
    const path = this.lockPath(id)
    if (readLock(path)?.pid === process.pid) {
      rmSync(path, { force: true })
    }
  }

  /** The lock of another process that writes a reply to the session now; none when nobody else does. */
  holder(id: string): SessionLock | undefined {
    const held = readLock(this.lockPath(id))
    return held !== undefined && held.pid !== process.pid && isAlive(held.pid) ? held : undefined
  }

  /**
   * A message was sent: the session moves to the top, titled by it if it was the first. Read from the folder first,
   * so what the other process changed, an archive say, stays.
   */
  used(id: string, text: string, model?: string): SessionMeta | undefined {
    const meta = this.meta(id)
    if (meta === undefined) {
      return undefined
    }
    const next = { ...meta, title: meta.title === '' ? titleOf(text) : meta.title, updated: Date.now() }
    if (model !== undefined) {
      next.model = model
    }
    this.save(next)
    return next
  }

  /**
   * Calls `changed` once something is written to the folder, by this process or another: a session made, a lock taken
   * or given back, a line appended. Writes close together, the lines of a reply as it streams, call it once. Returns
   * what stops it.
   */
  watch(changed: () => void, failed: (error: unknown) => void): () => Promise<void> {
    let pending: NodeJS.Timeout | undefined
    const watcher = watch(this.dir, { ignoreInitial: true, depth: 0 })
      .on('all', () => {
        pending ??= setTimeout(() => {
          pending = undefined
          changed()
        }, SETTLE_MS)
      })
      .on('error', failed)
    return async () => {
      clearTimeout(pending)
      await watcher.close()
    }
  }

  /** Closes the logs open for appending. */
  close(): void {
    for (const fd of this.logs.values()) {
      closeSync(fd)
    }
    this.logs.clear()
  }

  private metaPath(id: string): string {
    return join(this.dir, `${id}.json`)
  }

  private logPath(id: string): string {
    return join(this.dir, `${id}.jsonl`)
  }

  private lockPath(id: string): string {
    return join(this.dir, `${id}.lock`)
  }

  /**
   * The log's records from byte `from`, and how far it is read now. A log no longer than that is not opened: the
   * service asks each open session's whenever anything in the folder changes.
   */
  private readFrom(id: string, from: number, partial: boolean): LogRecord[] {
    const path = this.logPath(id)
    const size = statSync(path, { throwIfNoEntry: false })?.size ?? 0
    if (size <= from) {
      this.offsets.set(id, from)
      return []
    }
    const read = { to: from }
    const records = [...compact(parsed(linesOf(path, from, read, partial)))]
    this.offsets.set(id, read.to)
    return records
  }
}

function titleOf(text: string): string {
  const line = text.trim().split('\n')[0] ?? ''
  return line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH - 1)}…` : line
}

/** None when there is no lock, or it does not parse: one cut short as it was written is taken over. */
function readLock(path: string): SessionLock | undefined {
  try {
    const lock = JSON.parse(readFileSync(path, 'utf8')) as SessionLock
    return typeof lock.pid === 'number' ? lock : undefined
  } catch {
    return undefined
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // Another user's process is there all the same
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** The records of a log's lines; a line that does not parse is skipped. */
function* parsed(lines: Iterable<string>): Generator<LogRecord> {
  for (const line of lines) {
    if (line.trim() === '') {
      continue
    }
    let record: LogRecord
    try {
      record = JSON.parse(line) as LogRecord
    } catch {
      continue
    }
    yield record
  }
}

const CHUNK_SIZE = 1 << 20
const NEWLINE = 0x0a

/**
 * The lines of a file from byte `from`, read a chunk at a time: a log written a line a delta, before plugin-jsonl joined
 * them, can be longer than a string can be. `read.to` ends after the last whole line; a last line with no newline is
 * yielded only when `partial`, as one cut short by a crash rather than one still being written.
 */
function* linesOf(path: string, from: number, read: { to: number }, partial = true): Generator<string> {
  const fd = openSync(path, 'r')
  try {
    const chunk = Buffer.alloc(CHUNK_SIZE)
    // The line read so far, copied out of the chunk as it is read again
    const parts: Buffer[] = []
    let position = from
    read.to = from
    // Up to the size it had when the reading began: what is appended meanwhile is the next read's
    const size = fstatSync(fd).size
    while (position < size) {
      const n = readSync(fd, chunk, 0, Math.min(CHUNK_SIZE, size - position), position)
      if (n === 0) {
        break
      }
      const data = chunk.subarray(0, n)
      let start = 0
      for (let end = data.indexOf(NEWLINE); end !== -1; end = data.indexOf(NEWLINE, start)) {
        parts.push(data.subarray(start, end))
        yield Buffer.concat(parts).toString('utf8')
        parts.length = 0
        start = end + 1
        read.to = position + start
      }
      parts.push(Buffer.from(data.subarray(start)))
      position += n
    }
    if (partial && parts.length > 0) {
      yield Buffer.concat(parts).toString('utf8')
    }
  } finally {
    closeSync(fd)
  }
}
