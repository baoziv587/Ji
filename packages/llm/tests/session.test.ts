// session.use: switching agents keeps the conversation, and a run in progress switches at the next step boundary.
// session.id: new for each session unless a resumed one keeps its own.
import type { Context, SimpleStreamOptions } from '@mariozechner/pi-ai'
import type { Api, AssistantMessage, Model, RunEvent } from '../src/index.ts'
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from '@mariozechner/pi-ai'
import { describe, expect, it, onTestFinished } from 'vitest'
import { createAgent, createSession, tool, Type } from '../src/index.ts'

describe('session.use', () => {
  it('should run the next send with the new agent', async () => {
    // Arrange
    const sent: unknown[] = []
    const agent = createAgent({ model: thinker(sent, [answer, answer]) })
    const chat = createSession(agent)
    await chat.send('first').result

    // Act
    chat.use(agent.with({ thinking: 'xhigh' }))
    await chat.send('second').result

    // Assert
    expect(sent).toEqual([undefined, 'xhigh'])
    expect(chat.state.messages).toHaveLength(4)
  })

  it('should keep the state and the queued messages as they are', async () => {
    // Arrange
    const agent = createAgent({ model: thinker([], [answer, answer]) })
    const chat = createSession(agent)
    await chat.send('first').result
    const [state, pending] = [chat.state, chat.pending]

    // Act
    chat.use(agent.with({ thinking: 'high' }))

    // Assert
    expect(chat.state).toBe(state)
    expect(chat.pending).toBe(pending)
  })

  it('should switch a run in progress at the next step boundary, and report it in the next model_start', async () => {
    // Arrange
    const gate = Promise.withResolvers<void>()
    const started = Promise.withResolvers<void>()
    const wait = tool({
      name: 'wait',
      description: 'waits for the test',
      parameters: Type.Object({}),
      run: async () => {
        started.resolve()
        await gate.promise
        return 'opened'
      },
    })
    const sent: unknown[] = []
    const callWait = (): AssistantMessage => fauxAssistantMessage([fauxToolCall('wait', {})], { stopReason: 'toolUse' })
    const agent = createAgent({ model: thinker(sent, [callWait, answer]), tools: [wait] })
    const chat = createSession(agent)
    const r = chat.send('go')
    const events = collect(r)

    // Act
    await started.promise
    chat.use(agent.with({ thinking: 'high' }))
    gate.resolve()

    // Assert
    const starts = (await events).flatMap(e => (e.type === 'model_start' ? [e.thinking] : []))
    expect(starts).toEqual(['off', 'high'])
    expect(sent).toEqual([undefined, 'high'])
  })
})

describe('session.id', () => {
  it('should be new for each session, and kept when given', () => {
    // Arrange
    const agent = createAgent({ model: thinker([], []) })

    // Act
    const [a, b] = [createSession(agent), createSession(agent)]
    const resumed = createSession(agent, { id: a.id, state: a.state })

    // Assert
    expect(a.id).not.toBe(b.id)
    expect(resumed.id).toBe(a.id)
  })
})

// Helpers

function answer(): AssistantMessage {
  return fauxAssistantMessage('ok')
}

/** A model accepting off, high and xhigh; records the reasoning each request carries. */
function thinker(sent: unknown[], replies: Array<() => AssistantMessage>): Model<Api> {
  const faux = registerFauxProvider({ models: [{ id: 'thinker', reasoning: true }] })
  faux.setResponses(
    replies.map(reply => (_ctx: Context, options: SimpleStreamOptions | undefined) => {
      sent.push(options?.reasoning)
      return reply()
    }),
  )
  onTestFinished(() => faux.unregister())
  return {
    ...faux.getModel(),
    thinkingLevelMap: { minimal: null, low: null, medium: null, high: 'high', xhigh: 'max' },
  }
}

async function collect(source: AsyncIterable<RunEvent>): Promise<RunEvent[]> {
  const all: RunEvent[] = []
  for await (const e of source) {
    all.push(e)
  }
  return all
}
