import type { EnvUpdateExtension, Lens } from './advanced.ts'
import type { Agent, Extension } from './index.ts'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { focus, liftWiden, widen, withState } from './advanced.ts'
import { act, done, extend, unfold } from './index.ts'

type S = number[]
type Ext = Extension<S, number, number, string, string>

const base: Agent<S, number, number, string, string> = {
  async* policy(s) {
    yield `d${s.length}`
    return s.length >= 3 ? done(String(s.reduce((a, b) => a + b, 0))) : act(s.length + 1)
  },
  env: async a => a * 10,
  update: (s, _a, o) => [...s, o],
}

/** 只含 env / update 的中间件，liftWiden 能提升 */
const envAndUpdate: EnvUpdateExtension<S, number, number>[] = [
  { env: (a, next) => next(a * 2) },
  { env: async (a, next) => (await next(a)) + 1 },
  { env: async (a, next) => (a > 2 ? -a : next(a)) },
  { update: (s, a, o, next) => next(s, a, o * 3) },
  { update: (s, a, o, next) => next(s, a, o).slice(-2) },
  { update: (s, a, o, next) => (s.length > 1 ? next(next(s, a, o), a, o) : next(s, a, o)) },
]
const withPolicy: Ext[] = [
  ...envAndUpdate,
  { policy: (s, next) => next([...s, 100]) },
  {
    async* policy(s, next) {
      yield 'x'
      return yield* next(s)
    },
  },
]

async function trace<T>(agent: Agent<T, any, any, any, any>, s0: T): Promise<unknown[]> {
  const events: unknown[] = []
  try {
    for await (const e of unfold(agent, s0, 8)) {
      events.push(e)
    }
  }
  catch (e) {
    events.push(String(e))
  }
  return events
}

describe('widen：增加动作种类', () => {
  interface Compact { compact: true }
  const isCompact = (x: number | Compact): x is Compact => typeof x === 'object'
  const handlers = { env: async () => -1, update: (s: S): S => [s.length] }

  // 外层在新类型上发出新动作，确保新分支被走到
  const trigger: Extension<S, number | Compact, number, string, string> = {
    policy: (s, next) => (s.length === 2 && !s.includes(-1) ? (async function* () { return act({ compact: true as const }) })() : next(s)),
  }

  it('widen(extend(a, x)) ≃ extend(widen(a), liftWiden(x))', async () => {
    await fc.assert(fc.asyncProperty(fc.array(fc.constantFrom(...envAndUpdate), { maxLength: 3 }), async (xs) => {
      const lhs = extend(widen(extend(base, ...xs), isCompact, handlers), trigger)
      const rhs = extend(widen(base, isCompact, handlers), ...xs.map(x => liftWiden(x, isCompact)), trigger)
      expect(await trace(lhs, [])).toEqual(await trace(rhs, []))
    }), { numRuns: 200 })
  })

  it('liftWiden 在类型上拒绝 policy 中间件', () => {
    const policyExt: Ext = { policy: (s, next) => next(s) }
    // @ts-expect-error policy 中间件的输出含动作类型，没有通用提升
    expect(() => liftWiden(policyExt, isCompact)).not.toThrow()
  })
})

describe('withState：扩大状态', () => {
  interface T { messages: S, count: number }
  const lens: Lens<T, S> = { get: t => t.messages, set: (t, messages) => ({ ...t, messages }) }

  // 外层读写 T 的其余部分，确保 lens 之外的状态被正确保留
  const counter: Extension<T, number, number, string, string> = {
    update: (t, a, o, next) => {
      const t1 = next(t, a, o)
      return { ...t1, count: t1.count + 1 }
    },
    policy: (t, next) => (t.count >= 2 ? (async function* () { return done(`count=${t.count}`) })() : next(t)),
  }

  it('withState(extend(a, x)) ≃ extend(withState(a), focus(x))', async () => {
    await fc.assert(fc.asyncProperty(fc.array(fc.constantFrom(...withPolicy), { maxLength: 3 }), async (xs) => {
      const lhs = extend(withState(extend(base, ...xs), lens), counter)
      const rhs = extend(withState(base, lens), ...xs.map(x => focus(x, lens)), counter)
      expect(await trace(lhs, { messages: [], count: 0 })).toEqual(await trace(rhs, { messages: [], count: 0 }))
    }), { numRuns: 200 })
  })
})
