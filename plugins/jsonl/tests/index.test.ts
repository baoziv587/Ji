import type { Api, Model } from '@gaoxiang.ai/llm'
import { createAgent, createSession, definePlugin, tool, Type } from '@gaoxiang.ai/llm'
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from '@mariozechner/pi-ai'
import { afterEach, describe, expect, it } from 'vitest'
import { jsonl } from '../src/index.ts'

describe('jsonl', () => {
  it('should write one parsable line per event, tagged with the run and the session', async () => {
    // Arrange
    const lines: string[] = []
    const chat = createSession(
      createAgent({ model: faux([fauxAssistantMessage('hello')]), plugins: [jsonl(l => lines.push(l))] }),
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
    const model = faux([
      fauxAssistantMessage('help'),
      fauxAssistantMessage('x', { stopReason: 'error', errorMessage: 'down' }),
    ])
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
      createAgent({ model: faux([fauxAssistantMessage('hello')]), plugins: [jsonl(write, { state })] })

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
    const model = faux([fauxAssistantMessage('x', { stopReason: 'error', errorMessage: 'overloaded' })])
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
    const model = faux([
      fauxAssistantMessage([fauxToolCall('updating', {})], { stopReason: 'toolUse' }),
      fauxAssistantMessage('ok'),
    ])
    const chat = createSession(createAgent({ model, tools: [updating], plugins: [jsonl(l => lines.push(l))] }))

    // Act
    await chat.send('go').result

    // Assert
    const updates = lines
      .map(l => JSON.parse(l) as { type: string; data?: unknown })
      .filter(r => r.type === 'tool_update')
    expect(updates.map(u => u.data)).toEqual([0.5, { message: 'half', done: 1, total: 2 }])
  })
})

// Helpers

const registrations: Array<{ unregister: () => void }> = []
afterEach(() => {
  registrations.splice(0).forEach(r => r.unregister())
})

function faux(responses: Parameters<ReturnType<typeof registerFauxProvider>['setResponses']>[0]): Model<Api> {
  const registration = registerFauxProvider()
  registration.setResponses(responses)
  registrations.push(registration)
  return registration.getModel()
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const all: T[] = []
  for await (const x of source) {
    all.push(x)
  }
  return all
}
