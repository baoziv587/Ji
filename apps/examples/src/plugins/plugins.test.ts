import type { Turn, TurnEvent } from '@gaoxiang.ai/llm'
import type { Api, AssistantMessage, Context, FauxResponseStep, Message, Model, ToolCall } from '@mariozechner/pi-ai'
import { createAgent, createSession, textOf, tool, toolResult, user } from '@gaoxiang.ai/llm'
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider, Type } from '@mariozechner/pi-ai'
import { describe, expect, it, onTestFinished } from 'vitest'
import { budget } from './budget.ts'
import { compaction, cutIndex, SUMMARY_PREFIX } from './compaction.ts'
import { keepGoing } from './keep-going.ts'
import { truncate, truncateToolResults } from './truncate-tool-results.ts'

function fauxModel(script: FauxResponseStep[]): Model<Api> {
  const faux = registerFauxProvider()
  faux.setResponses(script)
  onTestFinished(() => faux.unregister())
  return faux.getModel()
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const all: T[] = []
  for await (const x of source) {
    all.push(x)
  }
  return all
}

const kinds = (turns: TurnEvent[]): Turn['kind'][] => turns.map(e => e.turn.kind)

const echo = tool({
  name: 'echo',
  description: 'echo text',
  parameters: Type.Object({ text: Type.String() }),
  run: ({ text }) => text,
})
const callEcho = (text: string): AssistantMessage => fauxAssistantMessage([fauxToolCall('echo', { text })], { stopReason: 'toolUse' })
const replyToLastUser = (ctx: Context): AssistantMessage => fauxAssistantMessage(`re:${ctx.messages.findLast(m => m.role === 'user')?.content}`)

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

    const r = createSession(agent).send('go')
    const [turns, state] = await Promise.all([collect(r.turns), r.state])

    expect(kinds(turns).filter(k => k === 'rewrite')).toHaveLength(1)
    expect(state.messages[0]).toMatchObject({ role: 'user', content: `${SUMMARY_PREFIX}\nthe summary` })
    expect(state.messages[1].role).toBe('assistant')
  })

  it('没超限时不压缩', async () => {
    const model = fauxModel([callEcho('small'), fauxAssistantMessage('answer')])
    const agent = createAgent({ model, tools: [echo], plugins: [compaction({ model, maxTokens: 10_000 })] })

    expect((await createSession(agent).send('go').summary).rewrites).toBe(0)
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

    const results = (await createSession(agent).send('go').state).messages.filter(m => m.role === 'toolResult')
    expect(JSON.stringify(results[0].content).length).toBeLessThan(700)
    expect(results[0].details).toEqual({ truncated: { originalChars: 5_000 } })
    expect(results[1].details).toBeUndefined()
  })
})

describe('keepGoing', () => {
  it('agent 空闲但任务没完成时插入「继续」，完成后停止', async () => {
    const model = fauxModel([fauxAssistantMessage('step 1'), fauxAssistantMessage('step 2 DONE')])
    const plugin = keepGoing({ isDone: s => s.messages.some(m => m.role === 'assistant' && textOf(m).includes('DONE')), prompt: 'continue' })

    const state = await createSession(createAgent({ model, plugins: [plugin] })).send('go').state
    expect(state.messages.map(m => (m.role === 'assistant' ? textOf(m) : m.content))).toEqual(['go', 'step 1', 'continue', 'step 2 DONE'])
    expect(plugin.select(state)).toBe(1)
  })

  it('最多继续 maxTimes 次', async () => {
    const model = fauxModel([replyToLastUser, replyToLastUser, replyToLastUser])
    const plugin = keepGoing({ isDone: () => false, maxTimes: 2, prompt: 'continue' })

    const summary = await createSession(createAgent({ model, plugins: [plugin] })).send('go').summary
    expect(summary.turns).toBe(3)
  })
})

describe('budget', () => {
  it('累计用量超过上限时结束，以最后一条助手消息作为结果', async () => {
    const model = fauxModel([callEcho('a'), callEcho('b'), fauxAssistantMessage('never reached')])
    const agent = createAgent({ model, tools: [echo], plugins: [budget({ maxTokens: 1 })] })

    const r = createSession(agent).send('go')
    expect((await r.summary).turns).toBe(1)
    expect((await r.result).stopReason).toBe('toolUse')
  })
})
