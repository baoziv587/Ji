import type { Api, Model } from '@ji.dev/llm'
import type { FakeReply } from '@ji.dev/testing'
import type { JsonlRecord } from '../src/index.ts'
import { createAgent, createSession, definePlugin, tool, Type } from '@ji.dev/llm'
import { assistantMessage, createFakeModel, textBlock, thinkingBlock, toolUse } from '@ji.dev/testing'
import { afterEach, describe, expect, it } from 'vitest'
import { compact, jsonl } from '../src/index.ts'

describe('jsonl', () => {
  it('should write one parsable line per event, tagged with the run and the session', async () => {
    // Arrange
    const lines: string[] = []
    const chat = createSession(
      createAgent({ model: faux([assistantMessage('hello')]), plugins: [jsonl(l => lines.push(l), { interval: 0 })] }),
    )

    // Act
    const events = await collect(chat.send('go'))

    // Assert
    const records = lines.map(line => JSON.parse(line) as { run: string; session: string; type: string })
    expect(records.map(r => r.type)).toEqual(events.map(e => e.type))
    expect(new Set(records.map(r => r.run)).size).toBe(1)
    expect(records.every(r => typeof r.session === 'string')).toBe(true)
  })

  it('should keep the plugin a model call was made by, and the error of a failed one', async () => {
    // Arrange
    const lines: string[] = []
    const helper = definePlugin({
      name: 'helper',
      async *decide(state, next, { complete }) {
        if (state.messages.length === 1) {
          yield* complete({ messages: state.messages })
        }
        return yield* next(state)
      },
    })
    const model = faux([assistantMessage('help'), assistantMessage('x', { stopReason: 'error', errorMessage: 'down' })])
    const agent = createAgent({ model, plugins: [helper, jsonl(l => lines.push(l))] })

    // Act
    await createSession(agent)
      .send('go')
      .result.catch(() => {})

    // Assert
    const records = lines.map(line => JSON.parse(line) as Record<string, unknown>)
    const models = records.filter(r => String(r.type).startsWith('model_'))
    expect(models.map(r => [r.type, r.by])).toEqual([
      ['model_start', 'helper'],
      ['model_end', 'helper'],
      ['model_start', undefined],
      ['model_error', undefined],
    ])
    expect(models.at(-1)).toMatchObject({ error: { name: 'ModelCallError', message: expect.stringContaining('down') } })
  })

  it('should leave the state out of step_end unless asked for', async () => {
    // Arrange
    const [without, withState]: string[][] = [[], []]
    const agent = (write: (l: string) => void, state: boolean): ReturnType<typeof createAgent> =>
      createAgent({ model: faux([assistantMessage('hello')]), plugins: [jsonl(write, { state })] })

    // Act
    await createSession(agent(l => without.push(l), false)).send('go').result
    await createSession(agent(l => withState.push(l), true)).send('go').result

    // Assert
    const stepEnd = (lines: string[]): Record<string, unknown> =>
      lines.map(l => JSON.parse(l) as Record<string, unknown>).find(r => r.type === 'step_end')!
    expect(stepEnd(without)).not.toHaveProperty('state')
    expect(stepEnd(withState)).toHaveProperty('state.messages')
  })

  it('should write a failed run error as its name, message and kind', async () => {
    // Arrange
    const lines: string[] = []
    const model = faux([assistantMessage('x', { stopReason: 'error', errorMessage: 'overloaded' })])
    const chat = createSession(createAgent({ model, plugins: [jsonl(l => lines.push(l))] }))

    // Act
    await chat.send('go').result.catch(() => {})

    // Assert
    const last = JSON.parse(lines.at(-1)!) as Record<string, unknown>
    expect(last).toMatchObject({ type: 'run_end', outcome: 'failed', error: { name: 'RunError', kind: 'provider' } })
    expect((last.error as { message: string }).message).toContain('overloaded')
  })

  it('should keep tool updates of any shape as they were yielded', async () => {
    // Arrange
    const lines: string[] = []
    const updating = tool({
      name: 'updating',
      description: 'yields updates',
      parameters: Type.Object({}),
      async *run() {
        yield 0.5
        yield { message: 'half', done: 1, total: 2 }
        return 'done'
      },
    })
    const model = faux([assistantMessage([toolUse('updating', {})]), assistantMessage('ok')])
    const chat = createSession(createAgent({ model, tools: [updating], plugins: [jsonl(l => lines.push(l))] }))

    // Act
    await chat.send('go').result

    // Assert
    const updates = lines
      .map(l => JSON.parse(l) as { type: string; data?: unknown })
      .filter(r => r.type === 'tool_update')
    expect(updates.map(u => u.data)).toEqual([0.5, { message: 'half', done: 1, total: 2 }])
  })

  it('should join what is streamed in an interval into one line, each kind and call apart', async () => {
    // Arrange
    const lines: string[] = []
    const thinking = 'step by step '.repeat(50)
    const text = 'saving both files '.repeat(50)
    const [a, b] = ['first '.repeat(100), 'second '.repeat(100)]
    const save = tool({
      name: 'save',
      description: 'saves a file',
      parameters: Type.Object({ content: Type.String() }),
      run: async () => 'saved',
    })
    const model = faux([
      assistantMessage([
        thinkingBlock(thinking),
        textBlock(text),
        toolUse('save', { content: a }, { id: 'a' }),
        toolUse('save', { content: b }, { id: 'b' }),
      ]),
      assistantMessage('ok'),
    ])
    const agent = createAgent({ model, tools: [save], plugins: [jsonl(l => lines.push(l), { interval: 60_000 })] })

    // Act
    const events = await collect(createSession(agent).send('go'))

    // Assert
    expect(events.filter(e => e.type === 'tool_call_delta').length).toBeGreaterThan(2)
    const records = lines.map(l => JSON.parse(l) as Record<string, any>)
    const streamed = records.filter(r => ['thinking', 'text', 'tool_call_delta'].includes(r.type))
    expect(streamed.map(r => [r.type, r.call?.id])).toEqual([
      ['thinking', undefined],
      ['text', undefined],
      ['tool_call_delta', 'a'],
      ['tool_call_delta', 'b'],
      ['text', undefined],
    ])
    expect(streamed[0].delta).toBe(thinking)
    expect(streamed[1].delta).toBe(text)
    expect(JSON.parse(streamed[2].delta)).toEqual({ content: a })
    expect(streamed[3].call.arguments).toEqual({ content: b })
  })

  it('should write each delta when the interval is 0', async () => {
    // Arrange
    const lines: string[] = []
    const model = faux([assistantMessage('a reply long enough to stream in more than one piece '.repeat(10))])
    const agent = createAgent({ model, plugins: [jsonl(l => lines.push(l), { interval: 0 })] })

    // Act
    const events = await collect(createSession(agent).send('go'))

    // Assert
    const texts = lines.map(l => JSON.parse(l) as { type: string }).filter(r => r.type === 'text')
    expect(texts.length).toBe(events.filter(e => e.type === 'text').length)
    expect(texts.length).toBeGreaterThan(1)
  })
})

describe('compact', () => {
  it('should join each run of deltas of one run, kind and call, and keep the rest as they were', () => {
    // Arrange
    const call = (id: string, content: string): object => ({
      type: 'toolCall',
      id,
      name: 'save',
      arguments: { content },
    })
    const records = [
      { run: 'r', session: 's', t: 1, type: 'thinking', delta: 'a' },
      { run: 'r', session: 's', t: 1, type: 'thinking', delta: 'b' },
      { run: 'r', session: 's', t: 1, type: 'text', delta: 'c' },
      { run: 'q', session: 's', t: 1, type: 'text', delta: 'd' },
      { run: 'r', session: 's', t: 1, type: 'tool_call_delta', call: call('x', 'e'), delta: 'e' },
      { run: 'r', session: 's', t: 1, type: 'tool_call_delta', call: call('x', 'ef'), delta: 'f' },
      { run: 'r', session: 's', t: 1, type: 'tool_call_delta', call: call('y', 'g'), delta: 'g' },
      { run: 'r', session: 's', t: 1, type: 'tool_call', call: call('y', 'g') },
      { run: 'r', session: 's', t: 2, type: 'text', delta: 'h' },
    ] as JsonlRecord[]

    // Act
    const compacted = [...compact(records)]

    // Assert
    expect(compacted.map(r => [r.type, r.run, 'delta' in r ? r.delta : undefined])).toEqual([
      ['thinking', 'r', 'ab'],
      ['text', 'r', 'c'],
      ['text', 'q', 'd'],
      ['tool_call_delta', 'r', 'ef'],
      ['tool_call_delta', 'r', 'g'],
      ['tool_call', 'r', undefined],
      ['text', 'r', 'h'],
    ])
    expect(compacted[3]).toMatchObject({ call: { arguments: { content: 'ef' } } })
  })
})

// Helpers

const registrations: Array<{ dispose: () => void }> = []
afterEach(() => {
  registrations.splice(0).forEach(r => r.dispose())
})

function faux(responses: FakeReply[]): Model<Api> {
  const fake = createFakeModel(responses)
  registrations.push(fake)
  return fake.model
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const all: T[] = []
  for await (const x of source) {
    all.push(x)
  }
  return all
}
