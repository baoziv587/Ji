import type { Stream } from '@gaoxiang.ai/kernel'
import type { Payload } from './types.ts'
import { mapYield } from '@gaoxiang.ai/kernel'

export type Middleware<I, O> = (input: I, next: (input: I) => O) => O

export function before<I, O>(f: (input: I) => I): Middleware<I, O> {
  return (input, next) => next(f(input))
}

/** Events pass through untouched; `g` maps only the final return value. Every stream hook takes it (request, tool). */
export function after<I, T, D = Payload>(g: (output: T, input: I) => T): Middleware<I, Stream<D, T>> {
  return (input, next) => mapReturn(next(input), value => g(value, input))
}

/**
 * Maps every event a stream hook yields one to one; the final return value is untouched.
 * This changes only what readers see. To change the stored message as well, add `after`.
 */
export function mapDeltas<I, T, D = Payload>(f: (delta: D, input: I) => D): Middleware<I, Stream<D, T>> {
  return (input, next) => mapYield(next(input), delta => f(delta, input))
}

async function* mapReturn<D, T>(stream: Stream<D, T>, g: (value: T) => T): Stream<D, T> {
  return g(yield* stream)
}
