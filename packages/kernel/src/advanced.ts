// @gaoxiang.ai/kernel/advanced: transforms that change an agent's type parameters (RFC-0003 §2.5, appendix A.4)
//
//   Each transform comes with a lift that moves middleware from the old types to the new ones, such that
//     transform(extend(a, x)) ≃ extend(transform(a), lift(x))
//   so code can always be written as extend(transform(base), ...extensions)

import type { Agent, Extension } from './index.ts'

/** Must satisfy: set(t, get(t)) = t; get(set(t, s)) = s; set(set(t, a), b) = set(t, b) */
export interface Lens<T, S> {
  get: (t: T) => S
  set: (t: T, s: S) => T
}

export function withState<S, T, A, O, R, D>(agent: Agent<S, A, O, R, D>, lens: Lens<T, S>): Agent<T, A, O, R, D> {
  return {
    policy: t => agent.policy(lens.get(t)),
    env: agent.env,
    update: (t, a, o) => lens.set(t, agent.update(lens.get(t), a, o)),
  }
}

/**
 * Lifts middleware written for S to T: it only sees the S part, the rest of T is preserved.
 * The focused update, with S-level middleware m and T-level next:
 *
 *     m(get(t), a, o, inner)            m may call inner 0..n times
 *       |
 *       +-- inner(s', a2, o2) --> latest = next(set(t, s'), a2, o2)   (always from the original t)
 *       |                    <--  get(latest)
 *       v
 *     s'' --> set(latest, s'')          S from m, rest of T from the last next() (t if none)
 */
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

export interface WidenHandlers<S, N, O> {
  env: (n: N) => Promise<O>
  update: (s: S, n: N, o: O) => S
}

/** Adds action kinds A → A | N. policy is unchanged: outer middleware emits new actions, handlers run them. */
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

/** Middleware without policy; passes to extend for any R and D. */
export type EnvUpdateExtension<S, A, O> = Omit<Extension<S, A, O, never, never>, 'policy'> & {
  policy?: never
}

/**
 * Lifts env / update middleware from A to A | N: new actions go straight to next, old ones through the middleware.
 * Policy middleware outputs A and has no generic lift, so it is rejected by the type; write it against A | N directly.
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
