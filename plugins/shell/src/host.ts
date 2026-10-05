// The Host port is the only process boundary (RFC §5.2), beside the files plugin's Workspace. It has one method, and
// its shape is the kernel's ε: output is the stream, the exit is the return value.
//
//   Contract of spawn:
//     1. Chunks come in the order they arrived; the exit is the return value. Text is decoded as UTF-8 incrementally.
//     2. On the signal, or when the stream is closed early, the process and everything it started is killed. What was
//        already read still comes out, and the stream returns an Exit; it does not throw.
//     3. It throws only when the process cannot start; CommandNotFoundError when the executable does not exist.
//     4. When the stream ends, no descendant is left alive.
//     5. stdin is closed from the start.
//     6. A consumer that stops reading stops the producer: memory does not grow with the output.
//   There are no time limits here: runProcess has them, so no backend writes its own.

import type { Chunk } from './core/fold.ts'

export type Stream<D, T> = AsyncGenerator<D, T, unknown>

/** A process to start. `argv` is passed as it is: no shell reads it unless argv[0] is one. */
export interface Spec {
  argv: readonly string[]
  /** Default: the host's own directory. */
  cwd?: string
  /** Added to the host's environment. */
  env?: Readonly<Record<string, string>>
}

export type Exit = { kind: 'exit'; code: number } | { kind: 'signal'; signal: string }

export interface Host {
  spawn: (spec: Spec, signal: AbortSignal) => Stream<Chunk, Exit>
}

/** The executable does not exist: told apart from other failures to start, so grep can say ripgrep is missing. */
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
 * The host behind `f`: every process is started as f(spec) says. Sandboxes, containers and extra environment are all
 * a Spec → Spec; wrapHost(wrapHost(h, f), g) = wrapHost(h, s => f(g(s))).
 */
export function wrapHost(host: Host, f: (spec: Spec) => Spec): Host {
  return { spawn: (spec, signal) => host.spawn(f(spec), signal) }
}

/** What a process in createMemoryHost does. */
export interface MemoryProcess {
  /** Written in order. Default none. */
  chunks?: readonly Chunk[]
  /** Waited before each chunk. Default 0. */
  gapMs?: number
  /** After the chunks, never exits on its own: only being killed ends it. */
  hangs?: boolean
  /** Default exit code 0. */
  exit?: Exit
}

export interface MemoryHost extends Host {
  /** Every spec spawned, in order. */
  readonly specs: readonly Spec[]
  /** Processes started and not yet ended. */
  readonly running: number
}

/** How a killed process ends, in every backend of this package. */
const KILLED: Exit = { kind: 'signal', signal: 'SIGKILL' }

/**
 * In memory, keeping the same contract as a real backend: a process can hang and be killed, so time limits,
 * cancellation and early closing are all testable without starting one. `script` may throw, as spawn does when a
 * process cannot start.
 */
export function createMemoryHost(script: (spec: Spec) => MemoryProcess): MemoryHost {
  const specs: Spec[] = []
  let running = 0

  async function* spawn(spec: Spec, signal: AbortSignal): Stream<Chunk, Exit> {
    specs.push(spec)
    const { chunks = [], gapMs = 0, hangs = false, exit = { kind: 'exit', code: 0 } } = script(spec)

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
    spawn,
    specs,
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
