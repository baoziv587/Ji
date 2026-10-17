// The sessions on disk, two files each in one folder (~/.ji/sessions by default):
//
//   <id>.json    what the list shows: the folder it works in, its title, when it was made and last used, archived,
//                and the model it runs on
//   <id>.jsonl   its log, one run event a line, as @ji.dev/plugin-jsonl writes it: what it is read back from
//   <id>.lock/   while a reply is written to it, a folder: owner.json in it says who writes it, the terminal or the
//                service, so the other waits
//
// The terminal and the service share the folder: each takes the lock for a reply, and reads what the other appended
// to a log (unread) before it goes on from it. Nothing is ever deleted: an archived session keeps both files.

import type { FSWatcher } from 'chokidar'
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
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import process from 'node:process'
import { compact } from '@ji.dev/plugin-jsonl'
import { watch } from 'chokidar'
import writeFileAtomic from 'write-file-atomic'
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

/** Who has a session's lock: what its owner.json holds. */
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

/** How often whenFree looks for a process gone without giving its lock back: nothing in the folder says so. */
const GONE_CHECK_MS = 1000

/** How many times lock tries for a lock that is given back, or left by a process that is gone, as it tries. */
const LOCK_ATTEMPTS = 3

/** How long a lock's folder can be there with nobody named in it before it counts as left by a crash. */
const UNNAMED_MS = 10_000

/** Where a lock folder goes on its way out, next to it: one rename takes it from everyone's sight at once. */
const ASIDE = '.aside'

export class SessionStore {
  private readonly dir: string
  private readonly writer: Writer
  /** The logs open for appending, by session id. */
  private readonly logs = new Map<string, number>()
  /** How far each log has been read or written by this process, in bytes. */
  private readonly offsets = new Map<string, number>()
  /** The sessions this process has the lock of. */
  private readonly locked = new Set<string>()

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
    // Whole: the other process reads it as it likes
    writeFileAtomic.sync(this.metaPath(meta.id), `${JSON.stringify(meta, null, 2)}\n`)
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
    const other: Writer = this.writer === 'terminal' ? 'desktop' : 'terminal'
    for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
      if (takeLock(path, mine)) {
        this.locked.add(id)
        return
      }
      const found = readLock(path)
      switch (found.state) {
        // Given back meanwhile
        case 'free':
          continue
        case 'unnamed':
          if (Date.now() - found.made < UNNAMED_MS) {
            throw new SessionBusyError(other)
          }
          break
        case 'held':
          if (found.lock?.pid === process.pid) {
            this.locked.add(id)
            return
          }
          if (found.lock !== undefined && isAlive(found.lock.pid)) {
            throw new SessionBusyError(found.lock.by)
          }
          break
      }
      removeStale(path, found)
    }
    // Taken by another each time it was free: theirs
    throw new SessionBusyError(this.holder(id)?.by ?? other)
  }

  /** Gives the session back, when this process has it. */
  unlock(id: string): void {
    this.locked.delete(id)
    const path = this.lockPath(id)
    const found = readLock(path)
    if (found.state === 'held' && found.lock?.pid === process.pid) {
      discard(path)
    }
  }

  /** The lock of another process that writes a reply to the session now; none when nobody else does. */
  holder(id: string): SessionLock | undefined {
    const found = readLock(this.lockPath(id))
    if (found.state !== 'held' || found.lock === undefined) {
      return undefined
    }
    const { lock } = found
    return lock.pid !== process.pid && isAlive(lock.pid) ? lock : undefined
  }

  /**
   * Resolves once no other process writes a reply to the session: as soon as it gives the lock back, and within
   * GONE_CHECK_MS of its process being gone without doing so. Keeps no process running on its own.
   */
  whenFree(id: string): Promise<void> {
    return new Promise(resolve => {
      let timer: NodeJS.Timeout | undefined
      let watcher: FSWatcher | undefined
      const check = (): void => {
        if (this.holder(id) === undefined) {
          clearInterval(timer)
          void watcher?.close()
          resolve()
        }
      }

      timer = setInterval(check, GONE_CHECK_MS).unref()
      watcher = watch(this.dir, { ignoreInitial: true, depth: 0, persistent: false })
        .on('all', (_, path) => {
          if (basename(path) === `${id}.lock`) {
            check()
          }
        })
        // A lock given back before the watcher read the folder goes unseen: looked at again once it has
        .on('ready', check)
        // The timer alone, then
        .on('error', () => void watcher?.close())
      check()
    })
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
   * Calls `changed` once something is written to the folder: a session made, a lock taken or given back, a line
   * appended by another process. Writes close together, the lines of a reply as it streams, call it once. Returns what
   * stops it.
   */
  watch(changed: () => void, failed: (error: unknown) => void): () => Promise<void> {
    let pending: NodeJS.Timeout | undefined
    const watcher = watch(this.dir, { ignoreInitial: true, depth: 0 })
      .on('all', (_, path) => {
        if (this.isOwnWrite(basename(path))) {
          return
        }
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
   * A write nobody else needs to hear of: a line of a reply this process writes, which no other can append to while it
   * has the lock, or a lock on its way out (discard).
   */
  private isOwnWrite(name: string): boolean {
    if (name.endsWith(ASIDE)) {
      return true
    }
    return name.endsWith('.jsonl') && this.locked.has(name.slice(0, -'.jsonl'.length))
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

/**
 * A lock's folder as it is now: none; made, with nobody named in it yet (or left so by a crash); or naming who has it,
 * none when owner.json does not parse. `text` is owner.json as read, for removeStale to tell it from a newer one.
 */
type LockFound =
  | { state: 'free' }
  | { state: 'unnamed'; made: number }
  | { state: 'held'; text: string; lock: SessionLock | undefined }

/**
 * Makes the lock's folder, which only one process can, then names this one in it: written whole, so another reads all
 * of it or nothing. False when the folder is there already.
 */
function takeLock(path: string, mine: SessionLock): boolean {
  try {
    mkdirSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return false
    }
    throw error
  }
  try {
    writeFileAtomic.sync(join(path, 'owner.json'), JSON.stringify(mine))
  } catch (error) {
    rmSync(path, { recursive: true, force: true })
    throw error
  }
  return true
}

function readLock(path: string): LockFound {
  const text = readText(join(path, 'owner.json'))
  if (text !== undefined) {
    return { state: 'held', text, lock: parseLock(text) }
  }
  const made = statSync(path, { throwIfNoEntry: false })?.mtimeMs
  return made === undefined ? { state: 'free' } : { state: 'unnamed', made }
}

/** None when it does not parse: owner.json is written whole, so one that does not was left broken. */
function parseLock(text: string): SessionLock | undefined {
  try {
    const lock = JSON.parse(text) as SessionLock
    return typeof lock.pid === 'number' ? lock : undefined
  } catch {
    return undefined
  }
}

/** None when there is no such file. */
function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

/**
 * Removes the lock at `path` when it is still the one `found`. It is moved aside first, which only one process can do:
 * one that took the lock meanwhile, after another took it over, gets it put back.
 */
function removeStale(path: string, found: LockFound): void {
  const aside = `${path}.${process.pid}${ASIDE}`
  try {
    renameSync(path, aside)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }
    throw error
  }
  const was = found.state === 'held' ? found.text : undefined
  if (readText(join(aside, 'owner.json')) !== was) {
    try {
      renameSync(aside, path)
      return
    } catch (error) {
      // A third took it meanwhile: its own stands
      if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        throw error
      }
    }
  }
  rmSync(aside, { recursive: true, force: true })
}

/** Gives a lock up: gone at once for everyone, and only then removed. */
function discard(path: string): void {
  const aside = `${path}.${process.pid}${ASIDE}`
  renameSync(path, aside)
  rmSync(aside, { recursive: true, force: true })
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
