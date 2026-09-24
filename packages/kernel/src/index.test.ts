import type { Agent } from './index.ts'
import { describe, expect, it } from 'vitest'
import { act, done, mapState, run, unfold } from './index.ts'

// 数到 n：S = number，A = 步长，O = 步长，R = 最终值
function counter(n: number): Agent<number, number, number, number> {
  return {
    async* policy(s) {
      return s >= n ? done(s) : act(1)
    },
    env: async a => a,
    update: (s, _a, o) => s + o,
  }
}

describe('kernel', () => {
  it('run 折叠整条轨迹，只返回结果', async () => {
    expect(await run(counter(3), 0)).toBe(3)
  })

  it('unfold 逐步产出 act，最后是 done', async () => {
    const tags: string[] = []
    for await (const e of unfold(counter(2), 0)) tags.push(e.tag)
    expect(tags).toEqual(['act', 'act', 'done'])
  })

  it('mapState 替换 δ', async () => {
    expect(await run(mapState(counter(10), s => s * 2), 1)).toBe(10) // 1 → 4 → 10
  })

  it('超过 maxSteps 抛错', async () => {
    await expect(run(counter(100), 0, 5)).rejects.toThrow('did not terminate within 5 steps')
  })
})
