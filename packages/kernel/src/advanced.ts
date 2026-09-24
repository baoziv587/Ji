// @pi-rsi/kernel/advanced：改变 agent 类型参数的变换（RFC-0003 §2.5、附录 A.4）
//
//   每个变换都配一个提升函数，把旧类型上的中间件搬到新类型上，并满足
//     transform(extend(a, x)) ≃ extend(transform(a), lift(x))
//   所以代码总能写成：extend(transform(base), ...extensions)

import type { Agent, Extension } from './index.ts'

/** 从 T 中取出 / 放回 S。须满足：set(t, get(t)) = t；get(set(t, s)) = s；set(set(t, a), b) = set(t, b) */
export interface Lens<T, S> {
  get: (t: T) => S
  set: (t: T, s: S) => T
}

/* ── 扩大状态：S → T ─────────────────────────────────── */
export function withState<S, T, A, O, R, D>(agent: Agent<S, A, O, R, D>, lens: Lens<T, S>): Agent<T, A, O, R, D> {
  return {
    policy: t => agent.policy(lens.get(t)),
    env: agent.env,
    update: (t, a, o) => lens.set(t, agent.update(lens.get(t), a, o)),
  }
}

/** 把写在 S 上的中间件提升到 T：只让它看到 S 部分，其余部分原样保留 */
export function focus<S, T, A, O, R, D>(ext: Extension<S, A, O, R, D>, lens: Lens<T, S>): Extension<T, A, O, R, D> {
  const { policy, env, update } = ext
  const focused: Extension<T, A, O, R, D> = { env }

  if (policy) {
    focused.policy = (t, next) => policy(lens.get(t), s => next(lens.set(t, s)))
  }

  if (update) {
    focused.update = (t, a, o, next) => {
      let latest = t
      const inner = (s: S, a2: A, o2: O): S => {
        latest = next(lens.set(t, s), a2, o2)
        return lens.get(latest)
      }
      return lens.set(latest, update(lens.get(t), a, o, inner))
    }
  }

  return focused
}

/* ── 增加动作种类：A → A | N ─────────────────────────── */
export interface WidenHandlers<S, N, O> {
  env: (n: N) => Promise<O>
  update: (s: S, n: N, o: O) => S
}

/** policy 不变；新动作由外层中间件发出，由 handlers 执行和记录 */
export function widen<S, A, N, O, R, D>(
  agent: Agent<S, A, O, R, D>,
  isNew: (x: A | N) => x is N,
  handlers: WidenHandlers<S, N, O>,
): Agent<S, A | N, O, R, D> {
  return {
    policy: agent.policy,
    env: x => (isNew(x) ? handlers.env(x) : agent.env(x)),
    update: (s, x, o) => (isNew(x) ? handlers.update(s, x, o) : agent.update(s, x, o)),
  }
}

/** 不含 policy 的中间件。可直接传给 extend，与 R、D 无关 */
export type EnvUpdateExtension<S, A, O> = Omit<Extension<S, A, O, never, never>, 'policy'> & { policy?: never }

/**
 * 把写在 A 上的 env / update 中间件提升到 A | N：新动作直接交给 next，旧动作走原中间件。
 * policy 中间件的输出含 A，没有通用提升；类型上拒绝，须直接针对新类型编写。
 */
export function liftWiden<S, A, N, O>(
  ext: EnvUpdateExtension<S, A, O>,
  isNew: (x: A | N) => x is N,
): EnvUpdateExtension<S, A | N, O> {
  const { env, update } = ext
  const lifted: EnvUpdateExtension<S, A | N, O> = {}

  if (env) {
    lifted.env = (x, next) => (isNew(x) ? next(x) : env(x, next))
  }

  if (update) {
    lifted.update = (s, x, o, next) => (isNew(x) ? next(s, x, o) : update(s, x, o, next))
  }

  return lifted
}
