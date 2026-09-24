// RFC-0004 附录 B.2 的定律 R1–R4
import type { Reducer } from './reduce.ts'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { combine, filterInput, mapInput, mapResult, reduce, scan } from './reduce.ts'

const count: Reducer<number, number> = { init: 0, reduce: n => n + 1 }
const sum: Reducer<number, number> = { init: 0, reduce: (s, x) => s + x }
const last: Reducer<number, number | undefined> = { init: undefined, reduce: (_, x) => x }
const average: Reducer<number, { n: number, s: number }, number> = {
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

describe('reducer 定律', () => {
  it('积（R1）：combine 一次遍历等于分别遍历', async () => {
    await fc.assert(fc.asyncProperty(inputs, reducers, reducers, async (xs, a, b) => {
      expect(await reduce(xs, combine({ a, b }))).toEqual({ a: await reduce(xs, a), b: await reduce(xs, b) })
    }), { numRuns: 300 })
  })

  it('分段（R2）：前一段的累加值可以作为后一段的初值', async () => {
    await fc.assert(fc.asyncProperty(inputs, inputs, reducers, async (xs, ys, r) => {
      const prefix = xs.reduce(r.reduce, r.init)
      expect(await reduce(ys, { ...r, init: prefix })).toEqual(await reduce([...xs, ...ys], r))
    }), { numRuns: 300 })
  })

  it('融合（R3）：先过滤 / 转换序列，等于过滤 / 转换 reducer 的输入', async () => {
    const even = (x: number): boolean => x % 2 === 0
    const double = (x: number): number => x * 2

    await fc.assert(fc.asyncProperty(inputs, reducers, async (xs, r) => {
      expect(await reduce(xs.filter(even), r)).toEqual(await reduce(xs, filterInput(r, even)))
      expect(await reduce(xs.map(double), r)).toEqual(await reduce(xs, mapInput(r, double)))
    }), { numRuns: 300 })
  })

  it('scan（R4）：每个输入输出一次，最后一次等于 reduce', async () => {
    await fc.assert(fc.asyncProperty(inputs, reducers, async (xs, r) => {
      const steps = await collect(scan(xs, r))
      expect(steps).toHaveLength(xs.length)
      if (xs.length > 0) {
        expect(steps.at(-1)).toEqual(await reduce(xs, r))
      }
    }), { numRuns: 300 })
  })

  it('mapResult 只改最终结果', async () => {
    expect(await reduce([1, 2, 3], mapResult(average, x => x * 10))).toBe(20)
  })

  it('combine({}) 是单位元', async () => {
    expect(await reduce([1, 2], combine({}))).toEqual({})
  })
})
