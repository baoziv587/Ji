import type { Agent, Extension, Stream } from './index.ts'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { act, done, extend, mapState, mapYield, MaxStepsError, merge, run, unfold } from './index.ts'

// Agent under test: S = number[], each step appends env's result, done at length 3
type S = number[]
type Ext = Extension<S, number, number, string, string>
type TestAgent = Agent<S, number, number, string, string>

const base: TestAgent = {
  async *policy(s) {
    yield `d${s.length}`
    return s.length >= 3 ? done(String(s.reduce((a, b) => a + b, 0))) : act(s.length + 1)
  },
  async *env(a) {
    return a * 10
  },
  update: (s, _a, o) => [...s, o],
}

/** One pre / post / around per field, covering all three shapes */
interface Sample {
  field: 'policy' | 'env' | 'update'
  kind: 'pre' | 'post' | 'around'
  ext: Ext
}

const samples: Sample[] = [
  { field: 'policy', kind: 'pre', ext: { policy: (s, next) => next([...s, 100]) } },
  {
    field: 'policy',
    kind: 'post',
    ext: {
      async *policy(s, next) {
        const step = yield* next(s)
        return step.tag === 'act' ? act(step.action + 1) : step
      },
    },
  },
  {
    field: 'policy',
    kind: 'around',
    ext: {
      async *policy(s, next) {
        yield 'x'
        return yield* next(s)
      },
    },
  },
  { field: 'env', kind: 'pre', ext: { env: (a, next) => next(a * 2) } },
  {
    field: 'env',
    kind: 'post',
    ext: {
      async *env(a, next) {
        return (yield* next(a)) + 1
      },
    },
  },
  {
    field: 'env',
    kind: 'around',
    ext: {
      async *env(a, next) {
        yield 'e'
        return a > 2 ? -a : yield* next(a)
      },
    },
  },
  { field: 'update', kind: 'pre', ext: { update: (s, a, o, next) => next(s, a, o * 3) } },
  { field: 'update', kind: 'post', ext: { update: (s, a, o, next) => next(s, a, o).slice(-2) } },
  {
    field: 'update',
    kind: 'around',
    ext: { update: (s, a, o, next) => (s.length > 1 ? next(next(s, a, o), a, o) : next(s, a, o)) },
  },
]

const sample = fc.constantFrom(...samples)
const exts = fc.array(
  sample.map(x => x.ext),
  { maxLength: 4 },
)

/** The event sequence is the observable behavior; a maxSteps error is recorded as an event too */
async function trace(agent: TestAgent): Promise<unknown[]> {
  const events: unknown[] = []
  try {
    for await (const e of unfold(agent, [], 8)) {
      events.push(e)
    }
  } catch (e) {
    events.push(String(e))
  }
  return events
}

async function expectSame(a: TestAgent, b: TestAgent): Promise<void> {
  expect(await trace(a)).toEqual(await trace(b))
}

describe('unfold / run', () => {
  it('run folds the whole trajectory and returns only the result', async () => {
    expect(await run(base, [])).toBe('60')
  })

  it('throws when maxSteps is exceeded', async () => {
    const endless = extend(base, { update: (s, a, o, next) => next(s, a, o).slice(-1) })
    await expect(run(endless, [], 5)).rejects.toThrow(MaxStepsError)
    await expect(run(endless, [], 5)).rejects.toThrow('did not terminate within 5 steps')
  })
})

describe('extend: laws from appendix A.1', () => {
  it('an empty extension does not change behavior', async () => {
    await expectSame(extend(base, {}), base)
    await expectSame(extend(base), base)
  })

  it('applying in batches equals applying at once (guarantee 1)', async () => {
    await fc.assert(
      fc.asyncProperty(exts, exts, async (xs, ys) => {
        await expectSame(extend(extend(base, ...xs), ...ys), extend(base, ...xs, ...ys))
      }),
      { numRuns: 300 },
    )
  })

  it('middleware on different fields commute (guarantee 2)', async () => {
    await fc.assert(
      fc.asyncProperty(sample, sample, async (x, y) => {
        fc.pre(x.field !== y.field)
        await expectSame(extend(base, x.ext, y.ext), extend(base, y.ext, x.ext))
      }),
      { numRuns: 300 },
    )
  })

  it('pre and post on the same field commute (guarantee 2)', async () => {
    for (const field of ['policy', 'env', 'update'] as const) {
      const pre = samples.find(x => x.field === field && x.kind === 'pre')!.ext
      const post = samples.find(x => x.field === field && x.kind === 'post')!.ext
      await expectSame(extend(base, pre, post), extend(base, post, pre))
    }
  })

  it('sensitivity: swapping two pres on the same field changes behavior', async () => {
    const double: Ext = { env: (a, next) => next(a * 2) }
    const inc: Ext = { env: (a, next) => next(a + 1) }
    expect(await trace(extend(base, double, inc))).not.toEqual(await trace(extend(base, inc, double)))
  })

  it('the outer layer receives input first and returns output last', async () => {
    const log: string[] = []
    const tag = (name: string): Ext => ({
      async *env(a, next) {
        log.push(`${name}>`)
        const o = yield* next(a)
        log.push(`<${name}`)
        return o
      },
    })
    await drain(extend(base, tag('inner'), tag('outer')).env(1))
    expect(log).toEqual(['outer>', 'inner>', '<inner', '<outer'])
  })

  it('mapState equals a post on update', async () => {
    const f = (s: S): S => s.map(v => v + 1)
    await expectSame(mapState(base, f), extend(base, { update: (s, a, o, next) => f(next(s, a, o)) }))
  })
})

describe('unfold: env streams its deltas (RFC-0005 A.0)', () => {
  it('should put env deltas after the policy deltas and before the act of the same step', async () => {
    // Arrange
    const agent: TestAgent = {
      ...base,
      async *env(a) {
        yield `e${a}`
        return a * 10
      },
    }

    // Act
    const events = await trace(agent)

    // Assert
    expect(events.slice(0, 3)).toEqual([
      { t: 0, tag: 'delta', delta: 'd0' },
      { t: 0, tag: 'delta', delta: 'e1' },
      { t: 0, tag: 'act', action: 1, obs: 10, state: [10] },
    ])
  })

  it('should keep inner env deltas between the deltas an outer layer yields before and after next', async () => {
    // Arrange
    const around = (name: string): Ext => ({
      async *env(a, next) {
        yield `${name}>`
        const o = yield* next(a)
        yield `<${name}`
        return o
      },
    })
    const inner: TestAgent = {
      ...base,
      async *env(a) {
        yield 'base'
        return a
      },
    }

    // Act
    const deltas = await deltasOf(extend(inner, around('in'), around('out')).env(1))

    // Assert
    expect(deltas).toEqual(['out>', 'in>', 'base', '<in', '<out'])
  })

  it('should run the finally block of env when the consumer stops while env is paused', async () => {
    // Arrange
    let closed = false
    const agent: TestAgent = {
      ...base,
      async *env(a) {
        try {
          yield 'working'
          return a
        } finally {
          closed = true
        }
      },
    }

    // Act
    const seen: unknown[] = []
    for await (const e of unfold(agent, [])) {
      seen.push(e)
      if (e.tag === 'delta' && e.delta === 'working') {
        break
      }
    }

    // Assert
    expect(closed).toBe(true)
    expect(seen).toHaveLength(2)
  })

  it('should always order each step as policy deltas, env deltas, then act', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.tuple(fc.nat({ max: 3 }), fc.nat({ max: 3 })), { minLength: 1 }), async plan => {
        // Arrange: step t yields plan[t][0] policy deltas and plan[t][1] env deltas
        const agent: Agent<number, number, number, string, string> = {
          async *policy(t) {
            if (t >= plan.length) {
              return done('end')
            }
            for (let i = 0; i < plan[t][0]; i++) {
              yield 'p'
            }
            return act(t)
          },
          async *env(t) {
            for (let i = 0; i < plan[t][1]; i++) {
              yield 'e'
            }
            return t
          },
          update: t => t + 1,
        }

        // Act
        const events = await collect(unfold(agent, 0, plan.length + 1))

        // Assert
        const steps = plan.map((_, t) =>
          events
            .filter(e => e.t === t)
            .map(e => (e.tag === 'delta' ? e.delta : e.tag))
            .join(''),
        )
        expect(steps).toEqual(plan.map(([p, e]) => `${'p'.repeat(p)}${'e'.repeat(e)}act`))
      }),
    )
  })
})

describe('merge', () => {
  it('should yield the deltas of every source and return their results in source order', async () => {
    // Arrange
    const sources = [stream(['a1', 'a2'], 'ra'), stream(['b1'], 'rb')]

    // Act
    const { deltas, result } = await drainAll(merge(sources))

    // Assert
    expect(deltas.toSorted()).toEqual(['a1', 'a2', 'b1'])
    expect(result).toEqual(['ra', 'rb'])
  })

  it('should return an empty list for no sources', async () => {
    // Arrange
    const sources: Stream<string, string>[] = []

    // Act
    const { deltas, result } = await drainAll(merge(sources))

    // Assert
    expect(deltas).toEqual([])
    expect(result).toEqual([])
  })

  it('should not hold back a fast source while a slow one is still working', async () => {
    // Arrange
    const gate = Promise.withResolvers<void>()
    const slow = (async function* () {
      await gate.promise
      yield 'slow'
      return 'rs'
    })()
    const merged = merge([slow, stream(['fast'], 'rf')])

    // Act
    const first = await merged.next()
    gate.resolve()
    const rest = await drainAll(merged)

    // Assert
    expect(first).toEqual({ done: false, value: 'fast' })
    expect(rest).toEqual({ deltas: ['slow'], result: ['rs', 'rf'] })
  })

  it('should always return results in source order and keep each source own delta order, whatever the timing', async () => {
    await fc.assert(
      fc.asyncProperty(fc.scheduler(), fc.array(fc.array(fc.nat())), async (s, plans) => {
        // Arrange
        const sources = plans.map((plan, id) => scheduledSource(s, id, plan, lifecycle()))

        // Act
        const { deltas, result } = await s.waitFor(drainAll(merge(sources)))

        // Assert
        expect(result).toEqual(plans.map((_, id) => id))
        plans.forEach((plan, id) => {
          const own = deltas.filter(d => d.source === id).map(d => d.value)
          expect(own).toEqual(plan)
        })
        expect(deltas).toHaveLength(plans.flat().length)
      }),
    )
  })

  it('should always close every source it started when the merged stream is cancelled early', async () => {
    await fc.assert(
      fc.asyncProperty(fc.scheduler(), fc.array(fc.array(fc.nat())), fc.nat(), async (s, plans, keep) => {
        // Arrange
        const life = lifecycle()
        const merged = merge(plans.map((plan, id) => scheduledSource(s, id, plan, life)))

        // Act
        await s.waitFor(
          (async () => {
            for (let i = 0; i < keep; i++) {
              if ((await merged.next()).done) {
                break
              }
            }
            await merged.return(undefined as never)
          })(),
        )

        // Assert: a source that never started holds nothing; every started one has run its finally
        expect(life.closed).toEqual(life.started)
      }),
    )
  })

  it('should close the other sources and rethrow when one source throws', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.scheduler(),
        fc.array(fc.array(fc.nat())),
        fc.array(fc.nat()),
        fc.nat(),
        async (s, others, failingPlan, at) => {
          // Arrange: the failing source throws before its delta number `at` (or before returning)
          const life = lifecycle()
          const failing = (async function* () {
            for (const [i, value] of failingPlan.entries()) {
              await s.schedule(Promise.resolve())
              if (i === at) {
                throw new Error('source failed')
              }
              yield { source: -1, value }
            }
            await s.schedule(Promise.resolve())
            throw new Error('source failed')
          })()
          const sources = [...others.map((plan, id) => scheduledSource(s, id, plan, life)), failing]

          // Act
          const outcome = s.waitFor(drainAll(merge(sources)))

          // Assert
          await expect(outcome).rejects.toThrow('source failed')
          expect(life.closed).toEqual(life.started)
        },
      ),
    )
  })
})

describe('mapYield', () => {
  /** Yields 1, 2, 3 and returns 'end'; records whether its finally block ran */
  function numbers(closed: { value: boolean }): AsyncGenerator<number, string, undefined> {
    return (async function* () {
      try {
        yield 1
        yield 2
        yield 3
        return 'end'
      } finally {
        closed.value = true
      }
    })()
  }

  it('maps every yielded value and keeps the return value', async () => {
    const mapped = mapYield(numbers({ value: false }), n => `#${n}`)
    const seen: string[] = []

    for (;;) {
      const r = await mapped.next()
      if (r.done) {
        expect(r.value).toBe('end')
        break
      }
      seen.push(r.value)
    }
    expect(seen).toEqual(['#1', '#2', '#3'])
  })

  it('passes an early return (cancellation) through to the source', async () => {
    const closed = { value: false }
    const mapped = mapYield(numbers(closed), n => n * 10)

    expect((await mapped.next()).value).toBe(10)
    await mapped.return(undefined as never)
    expect(closed.value).toBe(true)
  })
})

// Helpers

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const all: T[] = []
  for await (const x of source) {
    all.push(x)
  }
  return all
}

async function drainAll<D, T>(source: Stream<D, T>): Promise<{ deltas: D[]; result: T }> {
  const deltas: D[] = []
  for (;;) {
    const r = await source.next()
    if (r.done) {
      return { deltas, result: r.value }
    }
    deltas.push(r.value)
  }
}

async function drain<D, T>(source: Stream<D, T>): Promise<T> {
  return (await drainAll(source)).result
}

async function deltasOf<D, T>(source: Stream<D, T>): Promise<D[]> {
  return (await drainAll(source)).deltas
}

async function* stream<D, T>(deltas: D[], result: T): Stream<D, T> {
  yield* deltas
  return result
}

interface Lifecycle {
  started: Set<number>
  closed: Set<number>
}

function lifecycle(): Lifecycle {
  return { started: new Set(), closed: new Set() }
}

/** Yields each planned value after a scheduler-controlled pause, then returns its id; records start and close. */
function scheduledSource(
  s: fc.Scheduler,
  id: number,
  plan: number[],
  { started, closed }: Lifecycle,
): Stream<{ source: number; value: number }, number> {
  return (async function* () {
    started.add(id)
    try {
      for (const value of plan) {
        await s.schedule(Promise.resolve())
        yield { source: id, value }
      }
      await s.schedule(Promise.resolve())
      return id
    } finally {
      closed.add(id)
    }
  })()
}
