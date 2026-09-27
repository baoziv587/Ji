// @gaoxiang.ai/kernel: the algebraic core, independent of LLMs, tools and IO
//
//   π : S → D* · (A + R)     policy   decide: stream zero or more deltas D, then return a Step
//   ε : A → D* · O           env      act: stream zero or more deltas D, then return the observation
//   δ : S × A × O → S        update   state transition (synchronous, pure, streams nothing)
//
//   Everything with side effects is a stream of the same D; everything pure is a plain function (RFC-0005).
//
//   unfold = unroll (π, ε, δ) repeatedly until π lands in R
//   extend = wrap π, ε, δ with middleware (RFC-0003)

export type Stream<D, T> = AsyncGenerator<D, T, undefined>

export type Step<A, R> = { tag: 'act'; action: A } | { tag: 'done'; result: R }

export const act = <A>(action: A): Step<A, never> => ({ tag: 'act', action })
export const done = <R>(result: R): Step<never, R> => ({ tag: 'done', result })

export interface Agent<S, A, O, R, D = never> {
  policy: (s: S) => Stream<D, Step<A, R>>
  env: (a: A) => Stream<D, O>
  update: (s: S, a: A, o: O) => S
}

/** Each middleware is (input, next): skipping next intercepts, calling it more than once retries. */
export interface Extension<S, A, O, R, D = never> {
  policy?: (s: S, next: Agent<S, A, O, R, D>['policy']) => Stream<D, Step<A, R>>
  env?: (a: A, next: Agent<S, A, O, R, D>['env']) => Stream<D, O>
  update?: (s: S, a: A, o: O, next: Agent<S, A, O, R, D>['update']) => S
}

export type Event<S, A, O, R, D> =
  | { t: number; tag: 'delta'; delta: D }
  | { t: number; tag: 'act'; action: A; obs: O; state: S }
  | { t: number; tag: 'done'; result: R; state: S }

/** Thrown by unfold when π has not landed in R within maxSteps. */
export class MaxStepsError extends Error {
  readonly maxSteps: number

  constructor(maxSteps: number) {
    super(`agent did not terminate within ${maxSteps} steps`)
    this.name = 'MaxStepsError'
    this.maxSteps = maxSteps
  }
}

/**
 * The whole trajectory, down to token-level deltas, is one lazy stream:
 *
 *     for t in 0..maxSteps-1:
 *       π(s) --yield D--> { t, delta }
 *         |
 *         +-- done(r) --> { t, done, result: r, state: s }, return
 *         |
 *         +-- act(a)  --> ε(a) --yield D--> { t, delta }
 *                         o = what ε returned, s = δ(s, a, o)
 *                         { t, act, action: a, obs: o, state: s }, next t
 *     throw MaxStepsError
 *
 * A consumer `break` cancels: return() propagates through yield* to whichever of π or ε is running.
 */
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

    const o = yield* mapYield(ag.env(step.action), delta => ({ t, tag: 'delta', delta }) as const)
    s = ag.update(s, step.action, o)
    yield { t, tag: 'act', action: step.action, obs: o, state: s }
  }
  throw new MaxStepsError(maxSteps)
}

export async function run<S, A, O, R, D>(ag: Agent<S, A, O, R, D>, s: S, maxSteps?: number): Promise<R> {
  for await (const e of unfold(ag, s, maxSteps)) {
    if (e.tag === 'done') {
      return e.result
    }
  }
  throw new Error('unreachable')
}

/**
 * Earlier extensions sit inside, later ones outside. extend(agent, e1, e2).env(a):
 *
 *     e2.env(a, next) -----> e1.env(a, next) -----> agent.env(a)
 *                                                        |
 *     e2 result <----------- e1 result <------------     o
 *
 * The outermost layer sees the input first and returns the output last.
 * An extension that omits a field adds no layer for it.
 */
export function extend<S, A, O, R, D>(
  agent: Agent<S, A, O, R, D>,
  ...exts: Extension<S, A, O, R, D>[]
): Agent<S, A, O, R, D> {
  return exts.reduce(wrap, agent)
}

/** δ' = f ∘ δ */
export function mapState<S, A, O, R, D>(agent: Agent<S, A, O, R, D>, f: (s: S) => S): Agent<S, A, O, R, D> {
  return extend(agent, { update: (s, a, o, next) => f(next(s, a, o)) })
}

/** Like yield* with a map over each yielded value; keeps the return value and forwards cancellation upstream. */
export async function* mapYield<D, E, T>(it: Stream<D, T>, f: (d: D) => E): Stream<E, T> {
  try {
    for (;;) {
      const r = await it.next()
      if (r.done) {
        return r.value
      }
      yield f(r.value)
    }
  } finally {
    await it.return(undefined as never)
  }
}

/**
 * Runs several streams at once. Deltas come out in arrival order; the result lists every source's return value
 * in source order.
 *
 *     sources   a: a1 ─────── a2 ── return ra
 *               b: ── b1 ── return rb
 *     merged       a1 ── b1 ── a2 ── return [ra, rb]
 *
 * Every source is pulled as soon as its previous delta arrives, so a slow source never holds back a fast one.
 * Cancelling the merged stream (return()) closes every source that has not finished. If a source throws, the
 * others are closed first and then the error is rethrown.
 */
export async function* merge<D, T>(sources: ReadonlyArray<Stream<D, T>>): Stream<D, T[]> {
  const results: T[] = Array.from({ length: sources.length })
  const open = new Set(sources.keys())
  const arrived: Array<{ i: number; next: IteratorResult<D, T> } | { i: number; error: unknown }> = []
  let wake = Promise.withResolvers<void>()

  // Each source has at most one next() in flight; its outcome is queued, never raced, so nothing piles up.
  const pull = (i: number): void => {
    sources[i]
      .next()
      .then(
        next => arrived.push({ i, next }),
        (error: unknown) => arrived.push({ i, error }),
      )
      .then(() => wake.resolve())
  }

  try {
    open.forEach(pull)
    while (open.size > 0) {
      const item = arrived.shift()
      if (item === undefined) {
        await wake.promise
        wake = Promise.withResolvers<void>()
        continue
      }

      if ('error' in item) {
        open.delete(item.i)
        throw item.error
      }
      if (item.next.done) {
        open.delete(item.i)
        results[item.i] = item.next.value
        continue
      }
      pull(item.i)
      yield item.next.value
    }
    return results
  } finally {
    await Promise.all([...open].map(i => sources[i].return(undefined as never)))
  }
}

function wrap<S, A, O, R, D>(inner: Agent<S, A, O, R, D>, ext: Extension<S, A, O, R, D>): Agent<S, A, O, R, D> {
  const { policy, env, update } = ext

  return {
    policy: policy ? s => policy(s, inner.policy) : inner.policy,
    env: env ? a => env(a, inner.env) : inner.env,
    update: update ? (s, a, o) => update(s, a, o, inner.update) : inner.update,
  }
}
