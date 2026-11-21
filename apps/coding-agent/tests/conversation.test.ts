// A conversation: a reply that does not finish takes it back to before it was sent, and says what it was sent; one
// that finishes runs as long as it takes, a session's step limit aside
import type { Api, AssistantMessage, Model, Run } from '@ji.dev/llm'
import type { FakeRequest } from '@ji.dev/testing'
import { createAgent, tool, Type } from '@ji.dev/llm'
import { assistantMessage, createFakeModel, toolUse } from '@ji.dev/testing'
import { describe, expect, it, onTestFinished } from 'vitest'
import { Conversation } from '../src/agent/conversation.ts'

const tick = tool({
  name: 'tick',
  description: 'takes one step',
  parameters: Type.Object({}),
  run: () => 'ticked',
})

describe('conversation', () => {
  it('should go back to before a stopped reply under the same id, and give back its message and its steer', async () => {
    // Arrange
    const seen: number[] = []
    const conversation = new Conversation(createAgent({ model: faux(seen, [answer, answer]) }))
    const run = conversation.send('first')

    // Act
    const steer = conversation.send('second')
    const id = conversation.id
    const unfinished = await conversation.follow(run!, stopAtFirstEvent(conversation))
    const next = conversation.send('third')
    await conversation.follow(next!, readAll)

    // Assert
    expect(conversation.id).toBe(id)
    expect(steer).toBeUndefined()
    expect(unfinished).toMatchObject({ stopped: true, sent: ['first', 'second'] })
    // The next reply's model call sees only its own message
    expect(seen.at(-1)).toBe(1)
  })

  it('should finish a reply without going back, and be idle again', async () => {
    // Arrange
    const conversation = new Conversation(createAgent({ model: faux([], [answer]) }))
    const run = conversation.send('hello')

    // Act
    const replyingBefore = conversation.replying
    const unfinished = await conversation.follow(run!, readAll)

    // Assert
    expect([replyingBefore, conversation.replying]).toEqual([true, false])
    expect(unfinished).toBeUndefined()
  })

  it('should run a reply past the 64 steps a session allows by default', async () => {
    // Arrange: 70 steps of tool calls, then the answer
    const conversation = new Conversation(createAgent({ model: faux([], [...steps(70), answer]), tools: [tick] }))
    const run = conversation.send('take your time')

    // Act
    const unfinished = await conversation.follow(run!, readAll)

    // Assert
    expect(unfinished).toBeUndefined()
  })

  it('should keep that room for the reply that follows a stopped one', async () => {
    // Arrange: an answer to stop, then 70 steps of tool calls, then the answer
    const conversation = new Conversation(
      createAgent({ model: faux([], [answer, ...steps(70), answer]), tools: [tick] }),
    )
    const first = conversation.send('first')

    // Act
    await conversation.follow(first!, stopAtFirstText(conversation))
    const second = conversation.send('second')
    const unfinished = await conversation.follow(second!, readAll)

    // Assert
    expect(unfinished).toBeUndefined()
  })
})

// Helpers

/** A model that answers with `replies` in turn, noting how many messages each call was sent. */
function faux(seen: number[], replies: Array<() => AssistantMessage>): Model<Api> {
  const fake = createFakeModel(
    replies.map(reply => ({ messages }: FakeRequest) => {
      seen.push(messages.length)
      return reply()
    }),
  )
  onTestFinished(() => fake.dispose())
  return fake.model
}

function answer(): AssistantMessage {
  return assistantMessage('ok')
}

/** A step of the reply: a call to `tick`, so the model is asked again. */
function steps(count: number): Array<() => AssistantMessage> {
  return Array.from({ length: count }, () => () => assistantMessage([toolUse('tick', {})]))
}

async function readAll(run: Run): Promise<void> {
  for await (const _ of run) {
    // Only to the end
  }
}

function stopAtFirstEvent(conversation: Conversation): (run: Run) => Promise<void> {
  return async run => {
    for await (const _ of run) {
      conversation.stop()
    }
  }
}

/** Stops once the reply has had its model call: what it answered is spent, and the next reply asks again. */
function stopAtFirstText(conversation: Conversation): (run: Run) => Promise<void> {
  return async run => {
    for await (const e of run) {
      if (e.type === 'text') {
        conversation.stop()
      }
    }
  }
}
