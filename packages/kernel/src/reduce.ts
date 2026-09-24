// @gaoxiang.ai/kernel/reduce：对序列的归约（RFC-0004 附录 B.2）
//
//   只供库的实现和写底层扩展时使用。LLM 层用它实现 Run.summary 和插件状态，
//   使用者看到的是现成的字段，不直接接触这些函数。

/** reduce 必须同步、纯；result 默认原样返回累加值 */
export interface Reducer<In, Acc, Out = Acc> {
  init: Acc
  reduce: (acc: Acc, input: In) => Acc
  result?: (acc: Acc) => Out
}

type AnyReducer<In> = Reducer<In, any, any>
type AccOf<R> = R extends { init: infer Acc } ? Acc : never
/** 没有 result 时结果就是累加值 */
type OutOf<R> = R extends { result: (acc: any) => infer Out } ? Out : AccOf<R>

/** 一次遍历同时计算多个 reducer（R1） */
export function combine<In, Rs extends Record<string, AnyReducer<In>>>(
  reducers: Rs,
): Reducer<In, { [K in keyof Rs]: AccOf<Rs[K]> }, { [K in keyof Rs]: OutOf<Rs[K]> }> {
  const entries = Object.entries(reducers)

  return {
    init: Object.fromEntries(entries.map(([key, r]) => [key, r.init])) as { [K in keyof Rs]: AccOf<Rs[K]> },
    reduce: (acc, input) => Object.fromEntries(entries.map(([key, r]) => [key, r.reduce(acc[key], input)])) as typeof acc,
    result: acc => Object.fromEntries(entries.map(([key, r]) => [key, resultOf(r, acc[key])])) as { [K in keyof Rs]: OutOf<Rs[K]> },
  }
}

export function mapInput<A, B, Acc, Out>(r: Reducer<B, Acc, Out>, f: (input: A) => B): Reducer<A, Acc, Out> {
  return { ...r, reduce: (acc, input) => r.reduce(acc, f(input)) }
}

export function filterInput<A, B extends A, Acc, Out>(r: Reducer<B, Acc, Out>, pred: (input: A) => input is B): Reducer<A, Acc, Out>
export function filterInput<A, Acc, Out>(r: Reducer<A, Acc, Out>, pred: (input: A) => boolean): Reducer<A, Acc, Out>
export function filterInput<A, Acc, Out>(r: Reducer<A, Acc, Out>, pred: (input: A) => boolean): Reducer<A, Acc, Out> {
  return { ...r, reduce: (acc, input) => (pred(input) ? r.reduce(acc, input) : acc) }
}

export function mapResult<In, Acc, Out, Next>(r: Reducer<In, Acc, Out>, f: (out: Out) => Next): Reducer<In, Acc, Next> {
  return { ...r, result: acc => f(resultOf(r, acc)) }
}

/** 没有 result 时 Out 就是 Acc（类型参数的默认值），原样返回 */
export function resultOf<Acc, Out>(r: Reducer<any, Acc, Out>, acc: Acc): Out {
  return r.result ? r.result(acc) : passThrough<Out>(acc)
}

export async function reduce<In, Acc, Out>(source: AsyncIterable<In> | Iterable<In>, r: Reducer<In, Acc, Out>): Promise<Out> {
  let acc = r.init
  for await (const input of source) {
    acc = r.reduce(acc, input)
  }
  return resultOf(r, acc)
}

function passThrough<T>(value: unknown): T {
  return value as T
}

/** 每个输入之后输出一次中间结果（R4） */
export async function* scan<In, Acc, Out>(source: AsyncIterable<In> | Iterable<In>, r: Reducer<In, Acc, Out>): AsyncGenerator<Out, void> {
  let acc = r.init
  for await (const input of source) {
    acc = r.reduce(acc, input)
    yield resultOf(r, acc)
  }
}
