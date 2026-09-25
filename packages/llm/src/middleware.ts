import type { Stream } from '@gaoxiang.ai/kernel'

/** 中间件的通用形状 */
export type Middleware<I, O> = (input: I, next: (input: I) => O) => O

/** 只改输入的中间件：next(f(input)) */
export function before<I, O>(f: (input: I) => I): Middleware<I, O> {
  return (input, next) => next(f(input))
}

/**
 * 只改输出的中间件：g(await next(input))。
 * 用在返回流的钩子（request）上时，增量原样转发，g 只作用于最终的返回值。
 */
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
