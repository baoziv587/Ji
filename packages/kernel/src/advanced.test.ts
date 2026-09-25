import type { EnvUpdateExtension, Lens } from './advanced.ts'
import type { Agent, Extension } from './index.ts'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { focus, liftWiden, widen, withState } from './advanced.ts'
import { act, done, extend, unfold } from './index.ts'

type S = number[]
type Ext = Extension<S, number, number, string, string>

const base: Agent<S, number, number, string, string> = {
  async *policy(s) {
    yield `d${s.length}`
    return s.length >= 3 ? done(String(s.reduce((a, b) => a + b, 0))) : act(s.length + 1)
  },
  env: async a => a * 10,
  update: (s, _a, o) => [...s, o],
}

/** env / update only, so liftWiden can lift them */
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
    async *policy(s, next) {
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
  } catch (e) {
    events.push(String(e))
  }
  return events
}

describe('widen: adds action kinds', () => {
  interface Compact {
    compact: true
  }
  const isCompact = (x: number | Compact): x is Compact => typeof x === 'object'
  const handlers = { env: async () => -1, update: (s: S): S => [s.length] }

  // The outer layer emits a new action on the widened type so the new branch is exercised
  const trigger: Extension<S, number | Compact, number, string, string> = {
    policy: (s, next) =>
      s.length === 2 && !s.includes(-1)
        ? (async function* () {
            return act({ compact: true as const })
          })()
        : next(s),
  }

  it('widen(extend(a, x)) ≃ extend(widen(a), liftWiden(x))', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.constantFrom(...envAndUpdate), { maxLength: 3 }), async xs => {
        const lhs = extend(widen(extend(base, ...xs), isCompact, handlers), trigger)
        const rhs = extend(widen(base, isCompact, handlers), ...xs.map(x => liftWiden(x, isCompact)), trigger)
        expect(await trace(lhs, [])).toEqual(await trace(rhs, []))
      }),
      { numRuns: 200 },
    )
  })

  it('liftWiden rejects policy middleware at the type level', () => {
    const policyExt: Ext = { policy: (s, next) => next(s) }
    // @ts-expect-error policy middleware outputs the action type, so there is no generic lift
    expect(() => liftWiden(policyExt, isCompact)).not.toThrow()
  })
})

describe('withState: extends state', () => {
  interface T {
    messages: S
    count: number
  }
  const lens: Lens<T, S> = { get: t => t.messages, set: (t, messages) => ({ ...t, messages }) }

  // The outer layer reads and writes the rest of T to check that state outside the lens is preserved
  const counter: Extension<T, number, number, string, string> = {
    update: (t, a, o, next) => {
      const t1 = next(t, a, o)
      return { ...t1, count: t1.count + 1 }
    },
    policy: (t, next) =>
      t.count >= 2
        ? (async function* () {
            return done(`count=${t.count}`)
          })()
        : next(t),
  }

  it('withState(extend(a, x)) ≃ extend(withState(a), focus(x))', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.constantFrom(...withPolicy), { maxLength: 3 }), async xs => {
        const lhs = extend(withState(extend(base, ...xs), lens), counter)
        const rhs = extend(withState(base, lens), ...xs.map(x => focus(x, lens)), counter)
        expect(await trace(lhs, { messages: [], count: 0 })).toEqual(await trace(rhs, { messages: [], count: 0 }))
      }),
      { numRuns: 200 },
    )
  })
})

describe('focus: the cases the comment in advanced.ts walks through', () => {
  interface T {
    messages: S
    count: number
  }
  const lens: Lens<T, S> = { get: t => t.messages, set: (t, messages) => ({ ...t, messages }) }
  const t0: T = { messages: [1], count: 0 }

  /** The real next: appends o to messages and bumps count, so we can see which whole state survives */
  const next = (t: T, _a: number, o: number): T => ({ messages: [...t.messages, o], count: t.count + 1 })

  it('policy: the middleware sees only its part, and the rest of T is put back before next', async () => {
    const seen: S[] = []
    const ext = focus<S, T, number, number, string, never>(
      {
        policy: (s, inner) => {
          seen.push(s)
          return inner([...s, 99])
        },
      },
      lens,
    )
    const passed: T[] = []
    await ext.policy!(t0, (t) => {
      passed.push(t)
      return (async function* () {
        return done('ok')
      })()
    }).next()

    expect(seen).toEqual([[1]])
    expect(passed).toEqual([{ messages: [1, 99], count: 0 }])
  })

  it('update, next never called: the result keeps the rest of the original t', () => {
    const ext = focus<S, T, number, number, string, never>({ update: s => [...s, 7] }, lens)
    expect(ext.update!(t0, 0, 5, next)).toEqual({ messages: [1, 7], count: 0 })
  })

  it('update, next called twice: each call starts from the original t, the result keeps the rest of the last one', () => {
    const calls: T[] = []
    const spy = (t: T, a: number, o: number): T => {
      calls.push(t)
      return next(t, a, o)
    }
    const twice = focus<S, T, number, number, string, never>(
      { update: (s, a, o, inner) => [...inner(inner(s, a, o), a, o * 2), 0] },
      lens,
    )

    // second inner call receives the part returned by the first, put into the original t (count still 0)
    expect(twice.update!(t0, 0, 5, spy)).toEqual({ messages: [1, 5, 10, 0], count: 1 })
    expect(calls).toEqual([{ messages: [1], count: 0 }, { messages: [1, 5], count: 0 }])
  })
})

describe('widen / liftWiden: routing by action kind', () => {
  interface Compact {
    compact: true
  }
  const isCompact = (x: number | Compact): x is Compact => typeof x === 'object'
  const compact: Compact = { compact: true }

  it('widen sends new actions to the handlers and old ones to the agent', async () => {
    const widened = widen(base, isCompact, { env: async () => -1, update: s => [s.length] })

    expect(await widened.env(compact)).toBe(-1)
    expect(await widened.env(2)).toBe(20)
    expect(widened.update([4, 5], compact, -1)).toEqual([2])
    expect(widened.update([4, 5], 3, 30)).toEqual([4, 5, 30])
  })

  it('liftWiden skips the middleware for new actions and runs it for old ones', async () => {
    const lifted = liftWiden<S, number, Compact, number>({ env: async (a, next) => (await next(a)) + 1 }, isCompact)
    const inner = async (x: number | Compact): Promise<number> => (isCompact(x) ? -1 : x * 10)

    expect(await lifted.env!(compact, inner)).toBe(-1)
    expect(await lifted.env!(2, inner)).toBe(21)
  })
})
