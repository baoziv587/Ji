// The built-in commands: /compact sends the compaction plugin's command, once there is something to compact; /fast
// switches the priority tier, for OpenAI's models only
import type { Api, Model, Run } from '@ji.dev/llm'
import { createAgent } from '@ji.dev/llm'
import { COMPACT_COMMAND } from '@ji.dev/plugin-compaction'
import { assistantMessage, createFakeModel } from '@ji.dev/testing'
import { describe, expect, it, onTestFinished } from 'vitest'
import { Conversation } from '../src/agent/conversation.ts'
import { createCommandMenu } from '../src/ui/commands.ts'

describe('/compact', () => {
  it('should send nothing before the first reply, and the compaction command after it', async () => {
    // Arrange
    const conversation = new Conversation(createAgent({ model: faux() }))
    const sent: string[] = []
    const menu = createCommandMenu({ conversation, tools: [], mode: () => '', send: m => sent.push(m), quit: () => {} })

    // Act
    menu.run('/compact')
    const before = [...sent]
    await conversation.follow(conversation.send('hello')!, replied)
    menu.run('/compact')

    // Assert
    expect(before).toEqual([])
    expect(sent).toEqual([COMPACT_COMMAND])
  })
})

describe('/fast', () => {
  it('should switch on and off as told, and the other way round without a word', () => {
    // Arrange
    const conversation = new Conversation(createAgent({ model: { ...faux(), provider: 'openai' } }))
    const menu = createCommandMenu({ conversation, tools: [], mode: () => '', send: () => {}, quit: () => {} })
    const seen: boolean[] = []

    // Act
    for (const line of ['/fast on', '/fast on', '/fast', '/fast', '/fast off']) {
      menu.run(line)
      seen.push(conversation.fast)
    }

    // Assert
    expect(seen).toEqual([true, true, false, true, false])
  })

  it('should stay off for a model without the priority tier', () => {
    // Arrange
    const conversation = new Conversation(createAgent({ model: faux() }))
    const menu = createCommandMenu({ conversation, tools: [], mode: () => '', send: () => {}, quit: () => {} })

    // Act
    menu.run('/fast on')

    // Assert
    expect(conversation.fast).toBe(false)
  })
})

async function replied(run: Run): Promise<void> {
  await run.result
}

function faux(): Model<Api> {
  const fake = createFakeModel([assistantMessage('hi')])
  onTestFinished(() => fake.dispose())
  return fake.model
}
