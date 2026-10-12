// The sessions on disk, two files each in one folder (~/.ji/sessions by default):
//
//   <id>.json    what the list shows: the folder it works in, its title, when it was made and last used, archived,
//                and the model it runs on
//   <id>.jsonl   its log, one run event a line, as @ji.dev/plugin-jsonl writes it: what it is read back from
//
// Nothing is ever deleted: an archived session keeps both files.

import type { LogRecord } from './history.ts'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { join } from 'node:path'
import { compact } from '@ji.dev/plugin-jsonl'

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

export class SessionStore {
  private readonly dir: string
  /** The logs open for appending, by session id. */
  private readonly logs = new Map<string, number>()

  /** `dir` is made if it is not there. */
  constructor(dir: string) {
    this.dir = dir
    mkdirSync(dir, { recursive: true })
  }

  list(): SessionMeta[] {
    return readdirSync(this.dir)
      .filter(name => name.endsWith('.json'))
      .flatMap(name => {
        try {
          return [JSON.parse(readFileSync(join(this.dir, name), 'utf8')) as SessionMeta]
        } catch {
          return []
        }
      })
  }

  create(root: string, model?: string): SessionMeta {
    const now = Date.now()
    const meta: SessionMeta = { id: randomUUID(), root, title: '', created: now, updated: now, archived: false, model }
    this.save(meta)
    return meta
  }

  save(meta: SessionMeta): void {
    writeFileSync(this.metaPath(meta.id), `${JSON.stringify(meta, null, 2)}\n`)
  }

  /**
   * The session's log, read back with its deltas joined; a line that does not parse (cut short by a crash, say) is
   * skipped.
   */
  records(id: string): LogRecord[] {
    const path = this.logPath(id)
    if (!existsSync(path)) {
      return []
    }
    return [...compact(parsed(linesOf(path)))]
  }

  /** Appends a line to the session's log. */
  append(id: string, line: string): void {
    let fd = this.logs.get(id)
    if (fd === undefined) {
      fd = openSync(this.logPath(id), 'a')
      this.logs.set(id, fd)
    }
    writeSync(fd, `${line}\n`)
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
 * The lines of a file, read a chunk at a time: a log written a line a delta, before plugin-jsonl joined them, can be
 * longer than a string can be.
 */
function* linesOf(path: string): Generator<string> {
  const fd = openSync(path, 'r')
  try {
    const chunk = Buffer.alloc(CHUNK_SIZE)
    // The line read so far, copied out of the chunk as it is read again
    const parts: Buffer[] = []
    for (let n = readSync(fd, chunk); n > 0; n = readSync(fd, chunk)) {
      const data = chunk.subarray(0, n)
      let start = 0
      for (let end = data.indexOf(NEWLINE); end !== -1; end = data.indexOf(NEWLINE, start)) {
        parts.push(data.subarray(start, end))
        yield Buffer.concat(parts).toString('utf8')
        parts.length = 0
        start = end + 1
      }
      parts.push(Buffer.from(data.subarray(start)))
    }
    if (parts.length > 0) {
      yield Buffer.concat(parts).toString('utf8')
    }
  } finally {
    closeSync(fd)
  }
}
