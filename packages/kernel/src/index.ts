// @ji/kernel：代数内核，与 LLM / 工具 / IO 完全无关
//
//   π : S → D* · (A + R)     policy   决策：先流出若干增量 D，最后给出一个 Step
//   ε : A → O                env      副作用
//   δ : S × A × O → S        update   状态转移（同步、纯）
//
//   unfold = 反复展开 (π, ε, δ)，直到 π 落入 R
//   extend = 用中间件包装 π、ε、δ（RFC-0003）

/* ── 名词 ────────────────────────────────────────────── */
/** Stream<D, T>：边产出 D、最后返回 T 的异步流（就是 AsyncGenerator 本身） */
export type Stream<D, T> = AsyncGenerator<D, T, undefined>

export type Step<A, R>
  = | { tag: 'act', action: A }
    | { tag: 'done', result: R }

export const act = <A>(action: A): Step<A, never> => ({ tag: 'act', action })
export const done = <R>(result: R): Step<never, R> => ({ tag: 'done', result })

export interface Agent<S, A, O, R, D = never> {
  policy: (s: S) => Stream<D, Step<A, R>>
  env: (a: A) => Promise<O>
  update: (s: S, a: A, o: O) => S
}

/**
 * 三个可选中间件，形状统一为 (input, next)。
 * 不调用 next 即拦截，调用多次即重试。
 */
export interface Extension<S, A, O, R, D = never> {
  policy?: (s: S, next: Agent<S, A, O, R, D>['policy']) => Stream<D, Step<A, R>>
  env?: (a: A, next: Agent<S, A, O, R, D>['env']) => Promise<O>
  update?: (s: S, a: A, o: O, next: Agent<S, A, O, R, D>['update']) => S
}

export type Event<S, A, O, R, D>
  = | { t: number, tag: 'delta', delta: D }
    | { t: number, tag: 'act', action: A, obs: O, state: S }
    | { t: number, tag: 'done', result: R, state: S }

/* ── 动词 1：unfold，整条轨迹（含 token 级增量）是一个惰性流 ───── */
/** 消费方 break 即取消：return() 会沿 yield* 一路传到 provider 的 HTTP 流 */
export async function* unfold<S, A, O, R, D>(
  ag: Agent<S, A, O, R, D>,
  s: S,
  maxSteps = 32,
): Stream<Event<S, A, O, R, D>, void> {
  for (let t = 0; t < maxSteps; t++) {
    const step = yield* mapYield(ag.policy(s), delta => ({ t, tag: 'delta', delta }) as const)
    if (step.tag === 'done') {
      yield { t, tag: 'done', result: step.result, state: s }
      return
    }

    const o = await ag.env(step.action)
    s = ag.update(s, step.action, o)
    yield { t, tag: 'act', action: step.action, obs: o, state: s }
  }
  throw new Error(`agent did not terminate within ${maxSteps} steps`)
}

/* ── 动词 2：run，只要结果时折叠整条流 ───────────────── */
export async function run<S, A, O, R, D>(ag: Agent<S, A, O, R, D>, s: S, maxSteps?: number): Promise<R> {
  for await (const e of unfold(ag, s, maxSteps)) {
    if (e.tag === 'done') {
      return e.result
    }
  }
  throw new Error('unreachable')
}

/* ── 动词 3：extend，按顺序套上中间件 ───────────────── */
/** 列表中先出现的在内层，后出现的在外层：外层最先收到输入、最后返回输出 */
export function extend<S, A, O, R, D>(
  agent: Agent<S, A, O, R, D>,
  ...exts: Extension<S, A, O, R, D>[]
): Agent<S, A, O, R, D> {
  return exts.reduce(wrap, agent)
}

/** δ' = f ∘ δ：只改输出的 update 中间件 */
export function mapState<S, A, O, R, D>(agent: Agent<S, A, O, R, D>, f: (s: S) => S): Agent<S, A, O, R, D> {
  return extend(agent, { update: (s, a, o, next) => f(next(s, a, o)) })
}

/** yield* 的 map 版：变换每个产出，保留返回值，并把取消传给上游 */
export async function* mapYield<D, E, T>(it: Stream<D, T>, f: (d: D) => E): Stream<E, T> {
  try {
    for (;;) {
      const r = await it.next()
      if (r.done) {
        return r.value
      }
      yield f(r.value)
    }
  }
  finally {
    await it.return(undefined as never)
  }
}

/* ── 内部 ─────────────────────────────────────────────── */
function wrap<S, A, O, R, D>(inner: Agent<S, A, O, R, D>, ext: Extension<S, A, O, R, D>): Agent<S, A, O, R, D> {
  const {
    policy = (s, next) => next(s),
    env = (a, next) => next(a),
    update = (s, a, o, next) => next(s, a, o),
  } = ext

  return {
    policy: s => policy(s, inner.policy),
    env: a => env(a, inner.env),
    update: (s, a, o) => update(s, a, o, inner.update),
  }
}
