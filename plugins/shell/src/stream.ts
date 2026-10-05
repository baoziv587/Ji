// run = foldStream ∘ execute (RFC §1, §5.3). foldStream keeps what a tool needs of a command's stream and closes it once
// that is enough; it stays a stream, so a tool can yield* it for live output.

import type { Fold } from './core/fold.ts'

/** The kernel's ε shape: the items are the stream, the end is the return value. */
export type Stream<D, T> = AsyncGenerator<D, T, unknown>

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
