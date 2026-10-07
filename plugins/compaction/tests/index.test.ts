import type { Api, AssistantMessage, Message, Model, RunEvent, ToolCall, Usage } from '@ji.dev/llm'
import type { FakeReply } from '@ji.dev/testing'
import { createAgent, createSession, textOf, tool, toolResult, Type, user } from '@ji.dev/llm'
import { assistantMessage, createFakeModel, toolUse } from '@ji.dev/testing'
import { describe, expect, it, onTestFinished } from 'vitest'
import {
  COMPACT_COMMAND,
  contextTokens,
  createCompactionPlugin,
  cutIndex,
  estimateTokens,
  SUMMARY_PREFIX,
} from '../src/index.ts'

const echo = tool({
  name: 'echo',
  description: 'echo text',
  parameters: Type.Object({ text: Type.String() }),
  run: ({ text }) => text,
})

const call: ToolCall = { type: 'toolCall', id: 't1', name: 'echo', arguments: {} }

describe('estimateTokens', () => {
  it('should count about four ASCII characters a token, and a token for each CJK character', () => {
    expect(estimateTokens([user('a'.repeat(400))])).toBe(100)
    expect(estimateTokens([user('中'.repeat(400))])).toBe(400)
    expect(estimateTokens([user('😀'.repeat(10))])).toBe(10)
  })
})

describe('contextTokens', () => {
  it('should take the last assistant usage and estimate only what came after it', () => {
    // Arrange
    const messages = [user('q'), withUsage(callEcho('a'), 5_000), toolResult(call, 'a'.repeat(400))]

    // Act / Assert
    expect(contextTokens(messages)).toBe(5_000 + 100)
  })

  it('should not trust usage from before the last rewrite', () => {
    // Arrange
    const messages = [user('q'), withUsage(callEcho('a'), 5_000), toolResult(call, 'a'.repeat(400))]

    // Act / Assert
    expect(contextTokens(messages, 2)).toBe(estimateTokens(messages))
  })
})

describe('cutIndex', () => {
  it('should never start the kept part on a tool result', () => {
    // Arrange
    const messages: Message[] = [
      user('q'),
      callEcho('a'),
      toolResult(call, 'a'),
      toolResult(call, 'b'),
      assistantMessage('done'),
    ]

    // Act / Assert: only the last two fit, and 3 is a tool result
    expect(cutIndex(messages, estimateTokens(messages.slice(3)))).toBe(1)
  })

  it('should keep the last message even when it alone is over the budget', () => {
    const messages = [user('q'), assistantMessage('x'.repeat(4_000))]
    expect(cutIndex(messages, 10)).toBe(1)
  })
})

describe('createCompactionPlugin', () => {
  it('should replace the history with a summary plus the latest messages, then continue', async () => {
    // Arrange: the call and its result are over the limit, so compaction is due before the second model call
    const model = fauxModel([callEcho('x'.repeat(2_000)), assistantMessage('the summary'), assistantMessage('answer')])
    const plugin = createCompactionPlugin({ maxTokens: 400, keepRecentTokens: 50 })

    // Act
    const r = createSession(createAgent({ model, tools: [echo], plugins: [plugin] })).send('go')
    const [events, state] = await Promise.all([collect(r), r.state])

    // Assert
    expect((await r.summary).rewrites).toBe(1)
    expect(state.messages[0]).toMatchObject({ role: 'user', content: `${SUMMARY_PREFIX}\nthe summary` })
    expect(state.messages[1].role).toBe('assistant')
    expect(textOf(await r.result)).toBe('answer')
    expect(events.flatMap(e => (e.type.startsWith('compaction:') || 'by' in e ? [e.type] : []))).toEqual([
      'compaction:start',
      'model_start',
      'model_end',
      'compaction:end',
    ])
  })

  it('should keep the history and go on when the summary fails', async () => {
    // Arrange
    const fails: FakeReply = () => assistantMessage('', { stopReason: 'error', errorMessage: 'overloaded' })
    const model = fauxModel([callEcho('x'.repeat(2_000)), fails, assistantMessage('answer')])
    const plugin = createCompactionPlugin({ maxTokens: 400, keepRecentTokens: 50 })

    // Act
    const r = createSession(createAgent({ model, tools: [echo], plugins: [plugin] })).send('go')
    const [events, result] = await Promise.all([collect(r), r.result])

    // Assert
    expect(textOf(result)).toBe('answer')
    expect((await r.summary).rewrites).toBe(0)
    const end = events.find(e => e.type === 'compaction:end')
    expect(end).toMatchObject({ error: expect.stringContaining('overloaded') })
  })

  it('should keep the history when the summary comes back empty', async () => {
    // Arrange
    const model = fauxModel([callEcho('x'.repeat(2_000)), assistantMessage(''), assistantMessage('answer')])
    const plugin = createCompactionPlugin({ maxTokens: 400, keepRecentTokens: 50 })

    // Act
    const r = createSession(createAgent({ model, tools: [echo], plugins: [plugin] })).send('go')
    const [events, result] = await Promise.all([collect(r), r.result])

    // Assert
    expect(textOf(result)).toBe('answer')
    expect((await r.summary).rewrites).toBe(0)
    expect(events.find(e => e.type === 'compaction:end')).toMatchObject({ error: expect.stringContaining('empty') })
  })

  it('should keep the history for this step when the summary runs out of time', async () => {
    // Arrange
    const stalls: FakeReply = async ({ signal }) => {
      await new Promise(resolve => signal?.addEventListener('abort', resolve))
      return assistantMessage('too late')
    }
    const model = fauxModel([callEcho('x'.repeat(2_000)), stalls, assistantMessage('answer')])
    const plugin = createCompactionPlugin({ maxTokens: 400, keepRecentTokens: 50, timeoutMs: 10 })

    // Act
    const r = createSession(createAgent({ model, tools: [echo], plugins: [plugin] })).send('go')
    const [events, result] = await Promise.all([collect(r), r.result])

    // Assert: the idle step that ends the run does not try again
    expect(textOf(result)).toBe('answer')
    expect(events.filter(e => e.type === 'compaction:start')).toHaveLength(1)
    expect(events.find(e => e.type === 'model_error')).toMatchObject({ by: 'compaction' })
  })

  it('should not compact under the limit', async () => {
    const model = fauxModel([callEcho('small'), assistantMessage('answer')])
    const plugin = createCompactionPlugin({ maxTokens: 10_000 })

    const r = createSession(createAgent({ model, tools: [echo], plugins: [plugin] })).send('go')

    expect((await r.summary).rewrites).toBe(0)
  })

  it('should summarize everything but the last reply on /compact, without calling the model for a reply', async () => {
    // Arrange: a conversation well under the limit, then the summary
    const model = fauxModel([callEcho('small'), assistantMessage('answer'), assistantMessage('the summary')])
    const session = createSession(
      createAgent({ model, tools: [echo], plugins: [createCompactionPlugin({ maxTokens: 10_000 })] }),
    )
    await session.send('go').result

    // Act
    const r = session.send(COMPACT_COMMAND)
    const [events, state] = await Promise.all([collect(r), r.state])

    // Assert: the summary replaces all but the answer, the command is gone, and the run ends on the answer kept
    const answer = await r.result
    expect(textOf(answer)).toBe('answer')
    expect(state.messages).toHaveLength(2)
    expect(state.messages[0]).toMatchObject({ role: 'user', content: `${SUMMARY_PREFIX}\nthe summary` })
    expect(state.messages[1]).toBe(answer)
    expect((await r.summary).rewrites).toBe(1)
    expect(events.filter(e => e.type === 'model_start').map(e => e.by)).toEqual(['compaction'])
  })

  it('should say so on a /compact right after another', async () => {
    // Arrange: compacted once already, so only the summary and the last reply are left
    const model = fauxModel([assistantMessage('answer'), assistantMessage('the summary')])
    const session = createSession(createAgent({ model, plugins: [createCompactionPlugin({ maxTokens: 10_000 })] }))
    await session.send('go').result
    await session.send(COMPACT_COMMAND).result

    // Act
    const r = session.send(COMPACT_COMMAND)
    const [events, state] = await Promise.all([collect(r), r.state])

    // Assert: the history stays, the command is not in it, and no model is called
    expect(state.messages.map(m => m.role)).toEqual(['user', 'assistant'])
    expect(events.find(e => e.type === 'compaction:end')).toMatchObject({ error: expect.stringContaining('nothing') })
    expect(events.filter(e => e.type === 'model_start')).toHaveLength(0)
  })
})

function callEcho(text: string): AssistantMessage {
  return assistantMessage([toolUse('echo', { text })])
}

function withUsage(message: AssistantMessage, input: number): AssistantMessage {
  const usage: Usage = { ...message.usage, input, output: 0, cacheRead: 0, cacheWrite: 0 }
  return { ...message, usage }
}

function fauxModel(script: FakeReply[]): Model<Api> {
  const fake = createFakeModel(script)
  onTestFinished(() => fake.dispose())
  return fake.model
}

async function collect(source: AsyncIterable<RunEvent>): Promise<RunEvent[]> {
  const all: RunEvent[] = []
  for await (const e of source) {
    all.push(e)
  }
  return all
}
