// The local machine behind the Host port, and a file behind Log. The only file in the package that starts processes.
//
//   Each process leads its own process group, and the whole group is killed: on the signal, on an early close, and
//   when the process exits, so a background child cannot hold the pipes open. POSIX only.
//   Guarantee: a descendant that starts a session of its own (setsid, a double-forked daemon) leaves the group and is
//   not killed; that takes a cgroup, a container or a sandbox, behind a Host of its own.

import type { Chunk } from './core/fold.ts'
import type { Exit, Host, Log, Spec, Stream } from './host.ts'
import { spawn as spawnChild } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createWriteStream, mkdirSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { CommandNotFoundError } from './host.ts'

export interface LocalHostOptions {
  /** Where a process starts when its spec gives no cwd. Default: this process's. */
  cwd?: string
  /** The environment every process starts from. Default: this process's. */
  env?: Readonly<Record<string, string | undefined>>
}

/** Chunks waiting for the consumer before the pipes are paused. */
const HIGH_WATER = 64

export function createLocalHost({ cwd = process.cwd(), env = process.env }: LocalHostOptions = {}): Host {
  return {
    spawn: (spec, signal) => spawnLocal(spec, signal, cwd, env),
  }
}

/**
 * A new file in `dir` for each command; one whose output was all shown is deleted. A log that failed to write is
 * deleted too: the result never points at a partial file.
 */
export function createFileLog(dir: string): () => Log {
  return () => {
    mkdirSync(dir, { recursive: true })
    const path = join(dir, `${randomUUID().slice(0, 8)}.log`)

    let broken = false
    const file = createWriteStream(path).on('error', () => {
      broken = true
    })

    return {
      write: text => {
        file.write(text)
      },
      async close(keep) {
        await new Promise(resolve => file.end(resolve))
        if (keep && !broken) {
          return path
        }

        await rm(path, { force: true })
        return undefined
      },
    }
  }
}

async function* spawnLocal(
  spec: Spec,
  signal: AbortSignal,
  cwd: string,
  env: LocalHostOptions['env'],
): Stream<Chunk, Exit> {
  const [file, ...args] = spec.argv
  const child = spawnChild(file, args, {
    cwd: spec.cwd ?? cwd,
    env: { ...env, ...spec.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })

  const queue: Chunk[] = []
  let failed: Error | undefined
  let exit: Exit | undefined
  let wake: (() => void) | undefined
  const notify = (): void => {
    wake?.()
    wake = undefined
  }

  const killTree = (): void => {
    if (child.pid === undefined) {
      return
    }
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      // The group is already gone
    }
  }
  // What was not read yet is not waited for: the pipes close, and `close` follows the kill
  const kill = (): void => {
    killTree()
    child.stdout.destroy()
    child.stderr.destroy()
  }

  const receive = (fd: Chunk['fd']) => (text: string) => {
    queue.push({ fd, text })
    if (queue.length >= HIGH_WATER) {
      child.stdout.pause()
      child.stderr.pause()
    }
    notify()
  }
  child.stdout.setEncoding('utf8').on('data', receive(1))
  child.stderr.setEncoding('utf8').on('data', receive(2))

  // An error without a pid is a failure to start; later ones (a kill that failed) change nothing here
  child.on('error', (error: NodeJS.ErrnoException) => {
    if (child.pid === undefined) {
      failed = error.code === 'ENOENT' ? new CommandNotFoundError(file) : error
      notify()
    }
  })
  // A background child may still hold the pipes open: kill the group so `close` can follow
  child.on('exit', killTree)
  const closed = new Promise<void>(resolve => {
    child.on('close', (code, killedBy) => {
      exit = killedBy === null ? { kind: 'exit', code: code ?? 0 } : { kind: 'signal', signal: killedBy }
      notify()
      resolve()
    })
  })

  if (signal.aborted) {
    kill()
  }
  signal.addEventListener('abort', kill, { once: true })
  try {
    while (true) {
      const chunk = queue.shift()
      if (chunk !== undefined) {
        if (queue.length === 0) {
          child.stdout.resume()
          child.stderr.resume()
        }
        yield chunk
        continue
      }

      if (failed !== undefined) {
        throw failed
      }
      if (exit !== undefined) {
        return exit
      }
      await new Promise<void>(resolve => (wake = resolve))
    }
  } finally {
    signal.removeEventListener('abort', kill)
    // Closed early: nothing outlives the stream
    if (exit === undefined && failed === undefined) {
      kill()
      await closed
    }
  }
}
