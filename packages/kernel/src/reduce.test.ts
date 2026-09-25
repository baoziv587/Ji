// Laws R1–R4 from RFC-0004 appendix B.2
import type { Reducer } from './reduce.ts'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { combine, filterInput, mapInput, mapResult, reduce, scan } from './reduce.ts'

const count: Reducer<number, number> = { init: 0, reduce: n => n + 1 }
const sum: Reducer<number, number> = { init: 0, reduce: (s, x) => s + x }
const last: Reducer<number, number | undefined> = { init: undefined, reduce: (_, x) => x }
const average: Reducer<number, { n: number; s: number }, number> = {
  init: { n: 0, s: 0 },
  reduce: ({ n, s }, x) => ({ n: n + 1, s: s + x }),
  result: ({ n, s }) => (n === 0 ? 0 : s / n),
}

const reducers = fc.constantFrom<Reducer<number, any, any>>(count, sum, last, average)
const inputs = fc.array(fc.integer({ min: -100, max: 100 }), { maxLength: 30 })

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const all: T[] = []
  for await (const x of source) {
    all.push(x)
  }
  return all
}

describe('reducer laws', () => {
  it('product (R1): combine in one pass equals separate passes', async () => {
    await fc.assert(
      fc.asyncProperty(inputs, reducers, reducers, async (xs, a, b) => {
        expect(await reduce(xs, combine({ a, b }))).toEqual({
          a: await reduce(xs, a),
          b: await reduce(xs, b),
        })
      }),
      { numRuns: 300 },
    )
  })

  it('segments (R2): the accumulator of one segment can seed the next', async () => {
    await fc.assert(
      fc.asyncProperty(inputs, inputs, reducers, async (xs, ys, r) => {
        const prefix = xs.reduce(r.reduce, r.init)
        expect(await reduce(ys, { ...r, init: prefix })).toEqual(await reduce([...xs, ...ys], r))
      }),
      { numRuns: 300 },
    )
  })

  it('fusion (R3): filtering / mapping the sequence equals filtering / mapping the reducer input', async () => {
    const even = (x: number): boolean => x % 2 === 0
    const double = (x: number): number => x * 2

    await fc.assert(
      fc.asyncProperty(inputs, reducers, async (xs, r) => {
        expect(await reduce(xs.filter(even), r)).toEqual(await reduce(xs, filterInput(r, even)))
        expect(await reduce(xs.map(double), r)).toEqual(await reduce(xs, mapInput(r, double)))
      }),
      { numRuns: 300 },
    )
  })

  it('scan (R4): emits once per input, the last equals reduce', async () => {
    await fc.assert(
      fc.asyncProperty(inputs, reducers, async (xs, r) => {
        const steps = await collect(scan(xs, r))
        expect(steps).toHaveLength(xs.length)
        if (xs.length > 0) {
          expect(steps.at(-1)).toEqual(await reduce(xs, r))
        }
      }),
      { numRuns: 300 },
    )
  })

  it('mapResult changes only the final result', async () => {
    expect(
      await reduce(
        [1, 2, 3],
        mapResult(average, x => x * 10),
      ),
    ).toBe(20)
  })

  it('combine({}) is the identity', async () => {
    expect(await reduce([1, 2], combine({}))).toEqual({})
  })
})
