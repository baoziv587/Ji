// The local machine behind CommandExecutor, and a file behind Log. The only file in the package that starts processes.
//
//   Each process leads its own process group, and the whole group is killed: on the signal, on an early close, and
//   when the process exits, so a background child cannot hold the pipes open. Unread chunks past 64 pause the pipes,
//   so memory does not grow with the output. POSIX only.
//   Guarantee: a descendant that starts a session of its own (setsid, a double-forked daemon) leaves the group and is
//   not killed; that takes a cgroup, a container or a sandbox, behind an executor of its own.

import type { Chunk, Exit } from './core/fold.ts'
import type { CommandExecutor, Log } from './executor.ts'
import type { Stream } from './stream.ts'
import { spawn as spawnChild } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createWriteStream, mkdirSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { CommandNotFoundError, runWithClocks } from './executor.ts'

export interface LocalExecutorOptions {
  /** Where every process starts. Default: this process's directory. */
  cwd?: string
  /** The environment of every process. Default: this process's. */
  env?: Readonly<Record<string, string | undefined>>
  /** The one place a command line is given to a shell. Default: a non-login bash, which reads no profile. */
  shell?: (command: string) => readonly string[]
  /** A layer before every process, such as a sandbox: gets the argv about to start, returns the one to start. */
  wrapArgv?: (argv: readonly string[]) => readonly string[]
}

/** Chunks waiting for the consumer before the pipes are paused. */
const HIGH_WATER = 64

export function createLocalExecutor(options: LocalExecutorOptions = {}): CommandExecutor {
  const { cwd, env, shell = command => ['/bin/bash', '-c', command], wrapArgv = argv => argv } = options

  return {
    execute(command, executeOptions) {
      const argv = wrapArgv(typeof command === 'string' ? shell(command) : command)
      return runWithClocks(signal => spawnLocal(argv, { cwd, env }, signal), executeOptions)
    },
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

/** Runs argv until it exits or the signal fires, then kills its group: what runWithClocks needs of a process. */
async function* spawnLocal(
  argv: readonly string[],
  { cwd, env }: Pick<LocalExecutorOptions, 'cwd' | 'env'>,
  signal: AbortSignal,
): Stream<Chunk, Exit> {
  const [file, ...args] = argv
  const child = spawnChild(file, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true })

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
