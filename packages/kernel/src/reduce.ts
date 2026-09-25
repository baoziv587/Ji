// @gaoxiang.ai/kernel/reduce: reductions over sequences (RFC-0004 appendix B.2)
//
//   For library internals and low-level extensions only. The LLM layer uses it to implement Run.summary and
//   plugin state; end users see the ready-made fields and never touch these functions directly.

/** reduce must be synchronous and pure; without result, the accumulator is the output. */
export interface Reducer<In, Acc, Out = Acc> {
  init: Acc
  reduce: (acc: Acc, input: In) => Acc
  result?: (acc: Acc) => Out
}

type AnyReducer<In> = Reducer<In, any, any>
type AccOf<R> = R extends { init: infer Acc } ? Acc : never
type OutOf<R> = R extends { result: (acc: any) => infer Out } ? Out : AccOf<R>
type AccsOf<Rs> = { [K in keyof Rs]: AccOf<Rs[K]> }
type OutsOf<Rs> = { [K in keyof Rs]: OutOf<Rs[K]> }

/** Runs several reducers in a single pass (R1). */
export function combine<In, Rs extends Record<string, AnyReducer<In>>>(
  reducers: Rs,
): Reducer<In, AccsOf<Rs>, OutsOf<Rs>> {
  const entries = Object.entries(reducers)

  function each<T>(f: (key: string, r: AnyReducer<In>) => unknown): T {
    return Object.fromEntries(entries.map(([key, r]) => [key, f(key, r)])) as T
  }

  return {
    init: each<AccsOf<Rs>>((_, r) => r.init),
    reduce: (acc, input) => each<AccsOf<Rs>>((key, r) => r.reduce(acc[key], input)),
    result: acc => each<OutsOf<Rs>>((key, r) => resultOf(r, acc[key])),
  }
}

export function mapInput<A, B, Acc, Out>(r: Reducer<B, Acc, Out>, f: (input: A) => B): Reducer<A, Acc, Out> {
  return { ...r, reduce: (acc, input) => r.reduce(acc, f(input)) }
}

export function filterInput<A, B extends A, Acc, Out>(
  r: Reducer<B, Acc, Out>,
  pred: (input: A) => input is B,
): Reducer<A, Acc, Out>
export function filterInput<A, Acc, Out>(r: Reducer<A, Acc, Out>, pred: (input: A) => boolean): Reducer<A, Acc, Out>
export function filterInput<A, Acc, Out>(r: Reducer<A, Acc, Out>, pred: (input: A) => boolean): Reducer<A, Acc, Out> {
  return { ...r, reduce: (acc, input) => (pred(input) ? r.reduce(acc, input) : acc) }
}

export function mapResult<In, Acc, Out, Next>(r: Reducer<In, Acc, Out>, f: (out: Out) => Next): Reducer<In, Acc, Next> {
  return { ...r, result: acc => f(resultOf(r, acc)) }
}

/** Without result, Out defaults to Acc, so acc is returned as is. */
export function resultOf<Acc, Out>(r: Reducer<any, Acc, Out>, acc: Acc): Out {
  return r.result ? r.result(acc) : passThrough<Out>(acc)
}

export async function reduce<In, Acc, Out>(
  source: AsyncIterable<In> | Iterable<In>,
  r: Reducer<In, Acc, Out>,
): Promise<Out> {
  let acc = r.init
  for await (const input of source) {
    acc = r.reduce(acc, input)
  }
  return resultOf(r, acc)
}

function passThrough<T>(value: unknown): T {
  return value as T
}

/** Emits the intermediate result after every input (R4). */
export async function* scan<In, Acc, Out>(
  source: AsyncIterable<In> | Iterable<In>,
  r: Reducer<In, Acc, Out>,
): AsyncGenerator<Out, void> {
  let acc = r.init
  for await (const input of source) {
    acc = r.reduce(acc, input)
    yield resultOf(r, acc)
  }
}
