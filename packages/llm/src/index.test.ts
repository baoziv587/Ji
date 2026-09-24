// 用 pi-ai 的 faux provider 验证：完整回合、schema 校验、错误传播、取消
import { fauxAssistantMessage, fauxText, fauxToolCall, registerFauxProvider, Type } from '@mariozechner/pi-ai'
import { run, unfold } from '@pi-rsi/kernel'
import { describe, expect, it } from 'vitest'
import { llmAgent, textOf, tool, user } from './index.ts'

const echo = tool({
  name: 'echo',
  description: 'upper-case x',
  parameters: Type.Object({ x: Type.String() }),
  run: ({ x }) => x.toUpperCase(),
})

describe('llmAgent', () => {
  it('回合: 流 → 工具并行执行 → schema 校验失败作为观测 → 最终回答', async () => {
    const faux = registerFauxProvider()
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('echo', { x: 'hi' }), fauxToolCall('echo', { y: 1 })], { stopReason: 'toolUse' }),
      (ctx) => {
        const results = ctx.messages.filter(m => m.role === 'toolResult')
        expect(results.map(r => r.isError)).toEqual([false, true])
        const first = results[0].content[0]
        return fauxAssistantMessage(`got ${first.type === 'text' ? first.text : ''}`)
      },
    ])
    const final = await run(llmAgent(faux.getModel(), [echo]), [user('go')])
    expect(textOf(final)).toBe('got HI')
    faux.unregister()
  })

  it('错误: stopReason=error 会抛出', async () => {
    const faux = registerFauxProvider()
    faux.setResponses([fauxAssistantMessage([fauxText('partial')], { stopReason: 'error', errorMessage: 'boom' })])
    await expect(run(llmAgent(faux.getModel(), []), [user('go')])).rejects.toThrow(/boom/)
    faux.unregister()
  })

  it('取消: break 后底层请求被 abort', async () => {
    let seen: AbortSignal | undefined
    const faux = registerFauxProvider({ tokensPerSecond: 20 })
    faux.setResponses([(_ctx, opts) => {
      seen = opts?.signal
      return fauxAssistantMessage('a long long long long answer')
    }])
    let n = 0
    for await (const e of unfold(llmAgent(faux.getModel(), []), [user('go')])) {
      if (e.tag === 'delta' && e.delta.type === 'text_delta' && ++n === 2)
        break
    }
    expect(seen?.aborted).toBe(true)
    faux.unregister()
  })
})
