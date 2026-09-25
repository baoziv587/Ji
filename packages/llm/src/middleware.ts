import type { Stream } from '@gaoxiang.ai/kernel'

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

async function* mapReturn<D, T>(stream: Stream<D, T>, g: (value: T) => T): Stream<D, T> {
  return g(yield* stream)
}
