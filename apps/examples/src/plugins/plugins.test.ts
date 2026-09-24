import type { Api, FauxResponseStep, Message, Model, ToolCall } from '@mariozechner/pi-ai'
import type { AgentEvent, AgentState, LLMAgent } from '@pi-rsi/llm'
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider, Type } from '@mariozechner/pi-ai'
import { createAgent, isHistoryRewrite, stream, tool, toolResult, user } from '@pi-rsi/llm'
import { describe, expect, it, onTestFinished } from 'vitest'
import { compaction, cutIndex, SUMMARY_PREFIX } from './compaction.ts'
import { metrics, withFinalTurn, withStepTimings } from './metrics.ts'
import { truncate, truncateToolResults } from './truncate-tool-results.ts'

function fauxModel(script: FauxResponseStep[]): Model<Api> {
  const faux = registerFauxProvider()
  faux.setResponses(script)
  onTestFinished(() => faux.unregister())
  return faux.getModel()
}

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const all: AgentEvent[] = []
  for await (const e of events) {
    all.push(e)
  }
  return all
}

async function finalState(agent: LLMAgent, messages: Message[]): Promise<AgentState> {
  const last = (await collect(stream(agent, messages))).at(-1)
  if (last?.tag !== 'done') {
    throw new Error('agent did not finish')
  }
  return last.state
}

const echo = tool({
  name: 'echo',
  description: 'echo text',
  parameters: Type.Object({ text: Type.String() }),
  run: ({ text }) => text,
})
const callEcho = (text: string): ReturnType<typeof fauxAssistantMessage> => fauxAssistantMessage([fauxToolCall('echo', { text })], { stopReason: 'toolUse' })

describe('compaction', () => {
  it('切点不会落在工具结果上', () => {
    const call: ToolCall = { type: 'toolCall', id: 't1', name: 'echo', arguments: {} }
    const messages: Message[] = [user('q'), callEcho('a'), toolResult(call, 'a'), toolResult(call, 'b'), fauxAssistantMessage('done')]
    expect(cutIndex(messages, 2)).toBe(1)
  })

  it('超过上限时用「摘要 + 最近消息」替换历史，然后继续', async () => {
    const big = 'x'.repeat(2_000)
    // 第一轮后只有 3 条消息，切点为 1，太少不压缩；第二轮后才压缩
    const model = fauxModel([callEcho(big), callEcho('b'), fauxAssistantMessage('the summary'), fauxAssistantMessage('answer')])
    const agent = createAgent({ model, tools: [echo], plugins: [compaction({ model, maxTokens: 400, keepRecent: 2 })] })

    const events = await collect(stream(agent, [user('go')]))
    const rewrites = events.filter(e => e.tag === 'act' && isHistoryRewrite(e.action))
    const last = events.at(-1)

    expect(rewrites).toHaveLength(1)
    expect(last?.tag === 'done' && last.state.messages[0]).toMatchObject({ role: 'user', content: `${SUMMARY_PREFIX}\nthe summary` })
    expect(last?.tag === 'done' && last.state.messages[1].role).toBe('assistant')
  })

  it('没超限时不压缩', async () => {
    const model = fauxModel([callEcho('small'), fauxAssistantMessage('answer')])
    const agent = createAgent({ model, tools: [echo], plugins: [compaction({ model, maxTokens: 10_000 })] })

    const events = await collect(stream(agent, [user('go')]))
    expect(events.some(e => e.tag === 'act' && isHistoryRewrite(e.action))).toBe(false)
  })
})

describe('truncateToolResults', () => {
  it('保留开头和结尾，中间换成说明', () => {
    const text = `HEAD${'-'.repeat(10_000)}TAIL`
    const short = truncate(text, 1_000)

    expect(short.startsWith('HEAD')).toBe(true)
    expect(short.endsWith('TAIL')).toBe(true)
    expect(short.length).toBeLessThan(1_000)
    expect(truncate('small', 1_000)).toBe('small')
  })

  it('超过上限的工具结果被截短，原始长度记在 details', async () => {
    const model = fauxModel([callEcho('y'.repeat(5_000)), callEcho('ok'), fauxAssistantMessage('answer')])
    const agent = createAgent({ model, tools: [echo], plugins: [truncateToolResults({ maxChars: 500 })] })

    const results = (await finalState(agent, [user('go')])).messages.filter(m => m.role === 'toolResult')
    expect(JSON.stringify(results[0].content).length).toBeLessThan(700)
    expect(results[0].details).toEqual({ truncated: { originalChars: 5_000 } })
    expect(results[1].details).toBeUndefined()
  })
})

describe('metrics', () => {
  it('记录每次工具调用耗时，并累计 token 和工具调用数', async () => {
    const model = fauxModel([fauxAssistantMessage([fauxToolCall('echo', { text: 'a' }), fauxToolCall('echo', { text: 'b' })], { stopReason: 'toolUse' }), fauxAssistantMessage('answer')])
    const agent = createAgent({ model, tools: [echo], plugins: [metrics] })

    const events = await collect(stream(agent, [user('go')]))
    const last = events.at(-1)
    if (last?.tag !== 'done') {
      throw new Error('agent did not finish')
    }

    const own = metrics.select(last.state)
    expect(own).toMatchObject({ turns: 1, toolCalls: 2 })
    expect(own.inputTokens).toBeGreaterThan(0)
    expect(last.state.messages.filter(m => m.role === 'toolResult').every(r => typeof r.details?.durationMs === 'number')).toBe(true)
    expect(withFinalTurn(last.state, last.result).turns).toBe(2)
  })

  it('withStepTimings 每步报告一次，事件原样转发', async () => {
    const agent = createAgent({ model: fauxModel([callEcho('a'), fauxAssistantMessage('answer')]), tools: [echo] })
    const timings: number[] = []

    const events = await collect(withStepTimings(stream(agent, [user('go')]), timing => timings.push(timing.t)))
    expect(timings).toEqual([0, 1])
    expect(events.filter(e => e.tag !== 'delta').map(e => e.tag)).toEqual(['act', 'done'])
  })
})
