import type { Stream } from '@gaoxiang.ai/kernel'
import { mapYield } from '@gaoxiang.ai/kernel'

export type Middleware<I, O> = (input: I, next: (input: I) => O) => O

export function before<I, O>(f: (input: I) => I): Middleware<I, O> {
  return (input, next) => next(f(input))
}

/** On a stream-returning hook (request), deltas pass through untouched and `g` maps only the final return value. */
export function after<I, T>(g: (output: T, input: I) => T): Middleware<I, Promise<T>> & Middleware<I, Stream<any, T>> {
  return ((input: I, next: (input: I) => Promise<T> | Stream<unknown, T>) => {
    const output = next(input)
    return output instanceof Promise
      ? output.then(value => g(value, input))
      : mapReturn(output, value => g(value, input))
  }) as Middleware<I, Promise<T>> & Middleware<I, Stream<any, T>>
}

/**
 * Maps every streamed delta of a stream hook (request) one to one; the final return value is untouched.
 * This changes only what readers of `r.text` and the events see. To change the stored message as well, add `after`.
 */
export function mapDeltas<I, D, T>(f: (delta: D, input: I) => D): Middleware<I, Stream<D, T>> {
  return (input, next) => mapYield(next(input), delta => f(delta, input))
}

async function* mapReturn<D, T>(stream: Stream<D, T>, g: (value: T) => T): Stream<D, T> {
  return g(yield* stream)
}
