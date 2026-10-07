// A conversation: a reply that does not finish takes it back to before it was sent, and says what it was sent
import type { Api, AssistantMessage, Model, Run } from '@ji.dev/llm'
import type { FakeRequest } from '@ji.dev/testing'
import { createAgent } from '@ji.dev/llm'
import { assistantMessage, createFakeModel } from '@ji.dev/testing'
import { describe, expect, it, onTestFinished } from 'vitest'
import { Conversation } from '../src/agent/conversation.ts'

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
