// run = foldStream ∘ runProcess (RFC §1, §5.3). runProcess puts clocks on a host's stream; foldStream keeps what a tool
// needs of it and closes it once that is enough. Both stay streams, so a tool can yield* them for live output.
//
//   Clocks take the earliest (§3.3): every clock aborts one AbortController, only the first abort counts, and its
//   reason is the outcome. A new clock is one more abort on it.

import type { Chunk, Fold } from './core/fold.ts'
import type { Exit, Host, Spec, Stream } from './host.ts'

export interface Clocks {
  /** From the start of the process to its end. */
  totalMs?: number
  /** The longest the process may go without writing anything. */
  idleMs?: number
}

export interface Timeout {
  kind: 'timeout'
  clock: 'total' | 'idle'
  ms: number
}

/** How one process ended: its own exit, or the clock that stopped it. */
export type Outcome = Exit | Timeout

/**
 * The process's output with its clocks running. It returns the outcome; it throws when `signal` fires, since a
 * cancelled step has no result to give.
 */
export async function* runProcess(host: Host, spec: Spec, clocks: Clocks, signal: AbortSignal): Stream<Chunk, Outcome> {
  const stop = new AbortController()
  const start = (clock: Timeout['clock'], ms: number): ReturnType<typeof setTimeout> =>
    setTimeout(() => stop.abort({ kind: 'timeout', clock, ms } satisfies Timeout), ms)

  const { totalMs, idleMs } = clocks
  const total = totalMs === undefined ? undefined : start('total', totalMs)
  let idle = idleMs === undefined ? undefined : start('idle', idleMs)

  const chunks = host.spawn(spec, AbortSignal.any([signal, stop.signal]))
  try {
    let r = await chunks.next()
    while (!r.done) {
      if (idleMs !== undefined) {
        clearTimeout(idle)
        idle = start('idle', idleMs)
      }
      yield r.value
      r = await chunks.next()
    }

    signal.throwIfAborted()
    return stop.signal.aborted ? (stop.signal.reason as Timeout) : r.value
  } finally {
    clearTimeout(total)
    clearTimeout(idle)
    // Closed early, or ended: either way the host kills whatever is left
    stop.abort()
    await chunks.return(undefined as never)
  }
}

/**
 * Folds a stream while passing it on. Returns what was kept and how the stream ended; the end is undefined when the
 * fold was full first, and the stream was closed there.
 */
export async function* foldStream<D, M, T>(stream: Stream<D, T>, fold: Fold<D, M>): Stream<D, [M, T | undefined]> {
  let kept = fold.empty
  try {
    let r = await stream.next()
    while (!r.done) {
      kept = fold.step(kept, r.value)
      if (fold.full?.(kept)) {
        return [kept, undefined]
      }
      yield r.value
      r = await stream.next()
    }
    return [kept, r.value]
  } finally {
    await stream.return(undefined as never)
  }
}

/** The same stream, with `see` shown each item before it is passed on: for a log beside the fold. */
export async function* tapStream<D, T>(stream: Stream<D, T>, see: (item: D) => void): Stream<D, T> {
  try {
    let r = await stream.next()
    while (!r.done) {
      see(r.value)
      yield r.value
      r = await stream.next()
    }
    return r.value
  } finally {
    await stream.return(undefined as never)
  }
}

/** Runs a stream to its end, for a caller that wants no live output: the items are dropped, the end is returned. */
export async function streamResult<T>(stream: Stream<unknown, T>): Promise<T> {
  let r = await stream.next()
  while (!r.done) {
    r = await stream.next()
  }
  return r.value
}
