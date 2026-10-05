// CommandExecutor is the package's one interface (RFC §5.2), beside the files plugin's Workspace. Its shape is the
// kernel's ε: output is the stream, the outcome is the return value. Starting, timing and stopping are all behind it.
//
//   Writing an executor is keeping these seven:
//     1. Chunks come in the order they arrived; the outcome is the return value. Text is decoded as UTF-8 incrementally.
//     2. A string goes to a shell; an array never does: each element reaches the program as one argument. An executor
//        with a shell in between quotes it with quoteArgv, and says in its docs which shell it uses.
//     3. The earliest clock is the outcome: the command is stopped, and the stream returns a Timeout naming the clock,
//        after the output read so far. An executor that cannot keep a clock says so; it never ignores one quietly.
//     4. On the signal, the command is stopped and the stream throws: a cancelled step has no result.
//     5. When the stream is closed early, the command is stopped.
//     6. A command that fails is an Outcome; an environment that fails throws (RFC-0001 I8). A program in an array that
//        does not exist throws CommandNotFoundError. Through a shell only exit code 127 is seen, and a command may
//        return 127 itself: check before starting, never guess from the code.
//     7. stdin is closed from the start.
//   Leaving no descendant behind and bounded memory are not in the contract: each executor says which it guarantees.

import type { Chunk, Exit, Outcome, Timeout } from './core/fold.ts'
import type { Stream } from './stream.ts'

export interface CommandExecutor {
  /** A string is a command line for a shell to read. An array is argv as it is: no shell may read it. */
  execute: (command: Command, options: ExecuteOptions) => Stream<Chunk, Outcome>
}

/** A command line for a shell, or argv that no shell reads. */
export type Command = string | readonly string[]

export interface ExecuteOptions {
  /** Cancels the command: it is stopped, and the stream throws. */
  signal: AbortSignal
  /** From the start of the command to its end. */
  timeoutMs?: number
  /** The longest the command may go without writing anything. */
  idleMs?: number
}

/** The program does not exist: told apart from other failures to start, so grep can say ripgrep is missing. */
export class CommandNotFoundError extends Error {
  readonly command: string

  constructor(command: string) {
    super(`${command}: command not found`)
    this.name = 'CommandNotFoundError'
    this.command = command
  }
}

/** Keeps a command's whole output while its result keeps only part of it. */
export interface Log {
  write: (text: string) => void
  /** Where the output was kept; with `keep` false it is thrown away, and the result is undefined. */
  close: (keep: boolean) => Promise<string | undefined>
}

/**
 * For writing an executor: puts the clocks on a process. `start` runs it until it exits or its signal fires, and must
 * then have killed it. The earliest clock is the outcome; a cancelled command throws.
 *
 *   Clocks take the earliest (§3.3): every clock aborts one AbortController, only the first abort counts, and its
 *   reason is the outcome. A new clock is one more abort on it.
 */
export async function* runWithClocks(
  start: (signal: AbortSignal) => Stream<Chunk, Exit>,
  { signal, timeoutMs, idleMs }: ExecuteOptions,
): Stream<Chunk, Outcome> {
  const stop = new AbortController()
  const clock = (name: Timeout['clock'], ms: number): ReturnType<typeof setTimeout> =>
    setTimeout(() => stop.abort({ kind: 'timeout', clock: name, ms } satisfies Timeout), ms)

  const total = timeoutMs === undefined ? undefined : clock('total', timeoutMs)
  let idle = idleMs === undefined ? undefined : clock('idle', idleMs)

  const chunks = start(AbortSignal.any([signal, stop.signal]))
  try {
    let r = await chunks.next()
    while (!r.done) {
      if (idleMs !== undefined) {
        clearTimeout(idle)
        idle = clock('idle', idleMs)
      }
      yield r.value
      r = await chunks.next()
    }

    signal.throwIfAborted()
    return stop.signal.aborted ? (stop.signal.reason as Timeout) : r.value
  } finally {
    clearTimeout(total)
    clearTimeout(idle)
    // Closed early, or ended: either way whatever is left is killed
    stop.abort()
    await chunks.return(undefined as never)
  }
}

/** What a command in createMemoryExecutor does. */
export interface MemoryProcess {
  /** Written in order. Default none. */
  chunks?: readonly Chunk[]
  /** Waited before each chunk. Default 0. */
  gapMs?: number
  /** After the chunks, never exits on its own: only being stopped ends it. */
  hangs?: boolean
  /** Default exit code 0. */
  exit?: Exit
}

export interface MemoryExecutor extends CommandExecutor {
  /** Every command executed, in order. */
  readonly commands: readonly Command[]
  /** Commands started and not yet stopped. */
  readonly running: number
}

/** How a killed process ends. */
const KILLED: Exit = { kind: 'signal', signal: 'SIGKILL' }

/**
 * In memory, keeping the same contract as a real executor: a command can hang, time out and be cancelled, so all of
 * these are testable without starting a process. `script` may throw, as an environment that fails does.
 */
export function createMemoryExecutor(script: (command: Command) => MemoryProcess): MemoryExecutor {
  const commands: Command[] = []
  let running = 0

  async function* play(command: Command, signal: AbortSignal): Stream<Chunk, Exit> {
    commands.push(command)
    const { chunks = [], gapMs = 0, hangs = false, exit = { kind: 'exit', code: 0 } } = script(command)

    running++
    try {
      for (const chunk of chunks) {
        if (!(await wait(gapMs, signal))) {
          return KILLED
        }
        yield chunk
      }
      if (!(await wait(hangs ? Infinity : 0, signal))) {
        return KILLED
      }
      return exit
    } finally {
      running--
    }
  }

  return {
    execute: (command, options) => runWithClocks(signal => play(command, signal), options),
    commands,
    get running() {
      return running
    },
  }
}

/** True after `ms`; false as soon as the signal fires, or right away when it already has. */
function wait(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) {
    return Promise.resolve(false)
  }
  if (ms === 0) {
    return Promise.resolve(true)
  }

  return new Promise(resolve => {
    const timer = ms === Infinity ? undefined : setTimeout(done, ms, true)
    const abort = (): void => done(false)
    signal.addEventListener('abort', abort, { once: true })

    function done(passed: boolean): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      resolve(passed)
    }
  })
}
