// session.use: switching agents keeps the conversation, and a run in progress switches at the next step boundary.
// session.id: new for each session unless a resumed one keeps its own; every model call sends it as the sessionId.
import type { FakeRequest } from '@ji.dev/testing'
import type { Api, AssistantMessage, Model, RunEvent } from '../src/index.ts'
import { assistantMessage, createFakeModel, toolUse } from '@ji.dev/testing'
import { describe, expect, it, onTestFinished } from 'vitest'
import { before, createAgent, createSession, definePlugin, tool, Type } from '../src/index.ts'

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
    const callWait = (): AssistantMessage => assistantMessage([toolUse('wait', {})])
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

  it('should go with every model call as the sessionId, unless the agent sets its own', async () => {
    // Arrange
    const sent: Array<string | undefined> = []
    const watch = definePlugin({
      name: 'watch',
      request: before(req => {
        sent.push(req.options.sessionId)
        return req
      }),
    })
    const agent = createAgent({ model: thinker([], [answer, answer, answer]), plugins: [watch] })
    const chat = createSession(agent)

    // Act
    await chat.send('first').result
    await chat.send('second').result
    chat.use(agent.with({ sessionId: 'mine' }))
    await chat.send('third').result

    // Assert
    expect(sent).toEqual([chat.id, chat.id, 'mine'])
  })
})

// Helpers

function answer(): AssistantMessage {
  return assistantMessage('ok')
}

/** A model accepting off, high and xhigh; records the reasoning each request carries. */
function thinker(sent: unknown[], replies: Array<() => AssistantMessage>): Model<Api> {
  const fake = createFakeModel(
    replies.map(reply => (request: FakeRequest) => {
      sent.push(request.thinking)
      return reply()
    }),
    { id: 'thinker', reasoning: true },
  )
  onTestFinished(() => fake.dispose())
  return {
    ...fake.model,
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
