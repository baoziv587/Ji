import type { Agent, Extension } from './index.ts'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { act, done, extend, mapState, run, unfold } from './index.ts'

/* ── 被测 agent：S = number[]，每步追加 env 的结果，长度到 3 结束 ── */
type S = number[]
type Ext = Extension<S, number, number, string, string>
type TestAgent = Agent<S, number, number, string, string>

const base: TestAgent = {
  async* policy(s) {
    yield `d${s.length}`
    return s.length >= 3 ? done(String(s.reduce((a, b) => a + b, 0))) : act(s.length + 1)
  },
  env: async a => a * 10,
  update: (s, _a, o) => [...s, o],
}

/** 每个字段各有 pre / post / around，覆盖三种形态 */
interface Sample { field: 'policy' | 'env' | 'update', kind: 'pre' | 'post' | 'around', ext: Ext }

const samples: Sample[] = [
  { field: 'policy', kind: 'pre', ext: { policy: (s, next) => next([...s, 100]) } },
  { field: 'policy', kind: 'post', ext: {
    async* policy(s, next) {
      const step = yield* next(s)
      return step.tag === 'act' ? act(step.action + 1) : step
    },
  } },
  { field: 'policy', kind: 'around', ext: {
    async* policy(s, next) {
      yield 'x'
      return yield* next(s)
    },
  } },
  { field: 'env', kind: 'pre', ext: { env: (a, next) => next(a * 2) } },
  { field: 'env', kind: 'post', ext: { env: async (a, next) => (await next(a)) + 1 } },
  { field: 'env', kind: 'around', ext: { env: async (a, next) => (a > 2 ? -a : next(a)) } },
  { field: 'update', kind: 'pre', ext: { update: (s, a, o, next) => next(s, a, o * 3) } },
  { field: 'update', kind: 'post', ext: { update: (s, a, o, next) => next(s, a, o).slice(-2) } },
  { field: 'update', kind: 'around', ext: { update: (s, a, o, next) => (s.length > 1 ? next(next(s, a, o), a, o) : next(s, a, o)) } },
]

const sample = fc.constantFrom(...samples)
const exts = fc.array(sample.map(x => x.ext), { maxLength: 4 })

/** 事件序列即可观测行为；超步数的异常也记为一个事件 */
async function trace(agent: TestAgent): Promise<unknown[]> {
  const events: unknown[] = []
  try {
    for await (const e of unfold(agent, [], 8)) {
      events.push(e)
    }
  }
  catch (e) {
    events.push(String(e))
  }
  return events
}

async function expectSame(a: TestAgent, b: TestAgent): Promise<void> {
  expect(await trace(a)).toEqual(await trace(b))
}

describe('unfold / run', () => {
  it('run 折叠整条轨迹，只返回结果', async () => {
    expect(await run(base, [])).toBe('60')
  })

  it('超过 maxSteps 抛错', async () => {
    const endless = extend(base, { update: (s, a, o, next) => next(s, a, o).slice(-1) })
    await expect(run(endless, [], 5)).rejects.toThrow('did not terminate within 5 steps')
  })
})

describe('extend：附录 A.1 的定律', () => {
  it('空中间件不改变行为', async () => {
    await expectSame(extend(base, {}), base)
    await expectSame(extend(base), base)
  })

  it('分批应用 = 一次应用（承诺 1）', async () => {
    await fc.assert(fc.asyncProperty(exts, exts, async (xs, ys) => {
      await expectSame(extend(extend(base, ...xs), ...ys), extend(base, ...xs, ...ys))
    }), { numRuns: 300 })
  })

  it('不同字段上的中间件可交换（承诺 2）', async () => {
    await fc.assert(fc.asyncProperty(sample, sample, async (x, y) => {
      fc.pre(x.field !== y.field)
      await expectSame(extend(base, x.ext, y.ext), extend(base, y.ext, x.ext))
    }), { numRuns: 300 })
  })

  it('同一字段上的 pre 与 post 可交换（承诺 2）', async () => {
    for (const field of ['policy', 'env', 'update'] as const) {
      const pre = samples.find(x => x.field === field && x.kind === 'pre')!.ext
      const post = samples.find(x => x.field === field && x.kind === 'post')!.ext
      await expectSame(extend(base, pre, post), extend(base, post, pre))
    }
  })

  it('灵敏度：同一字段上两个 pre 交换顺序，行为不同', async () => {
    const double: Ext = { env: (a, next) => next(a * 2) }
    const inc: Ext = { env: (a, next) => next(a + 1) }
    expect(await trace(extend(base, double, inc))).not.toEqual(await trace(extend(base, inc, double)))
  })

  it('外层先收到输入、最后返回输出', async () => {
    const log: string[] = []
    const tag = (name: string): Ext => ({
      env: async (a, next) => {
        log.push(`${name}>`)
        const o = await next(a)
        log.push(`<${name}`)
        return o
      },
    })
    await base.env(1)
    await extend(base, tag('inner'), tag('outer')).env(1)
    expect(log).toEqual(['outer>', 'inner>', '<inner', '<outer'])
  })

  it('mapState = update 上的 post', async () => {
    const f = (s: S): S => s.map(v => v + 1)
    await expectSame(mapState(base, f), extend(base, { update: (s, a, o, next) => f(next(s, a, o)) }))
  })
})
