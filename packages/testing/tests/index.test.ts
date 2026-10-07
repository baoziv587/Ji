// createFakeModel: a model of the catalog that replies as scripted, called here the way @ji.dev/llm calls a model
import type { FakeModel } from '../src/index.ts'
import { models } from '@ji.dev/models'
import { describe, expect, it, onTestFinished } from 'vitest'
import { assistantMessage, createFakeModel, textBlock, toolUse } from '../src/index.ts'

describe('createFakeModel', () => {
  it('should give the scripted replies in order and count the calls', async () => {
    // Arrange
    const fake = createFakeModel([assistantMessage('one'), assistantMessage('two')])
    onTestFinished(fake.dispose)

    // Act
    const first = await ask(fake, 'a')
    const second = await ask(fake, 'b')

    // Assert
    expect(first.content).toEqual([textBlock('one')])
    expect(second.content).toEqual([textBlock('two')])
    expect(fake.calls()).toBe(2)
    expect(fake.pending()).toBe(0)
  })

  it('should show a scripted function the request without the system message, and with the tools by name', async () => {
    // Arrange
    const seen: { messages: number; system: string; tools: string[] }[] = []
    const fake = createFakeModel([
      ({ messages, system, tools }) => {
        seen.push({ messages: messages.length, system, tools })
        return assistantMessage('ok')
      },
    ])
    onTestFinished(fake.dispose)

    // Act
    await ask(fake, 'go', { system: 'be brief' })

    // Assert
    expect(seen).toEqual([{ messages: 1, system: 'be brief', tools: [] }])
  })

  it('should carry the thinking level of a reasoning model and none otherwise', async () => {
    // Arrange
    const levels: unknown[] = []
    const record = ({ thinking }: { thinking: unknown }) => {
      levels.push(thinking)
      return assistantMessage('ok')
    }
    const thinker = createFakeModel([record], { id: 'thinker', reasoning: true })
    const plain = createFakeModel([record])
    onTestFinished(thinker.dispose)
    onTestFinished(plain.dispose)

    // Act
    await ask(thinker, 'go', { reasoning: 'high' })
    await ask(plain, 'go')

    // Assert
    expect(levels).toEqual(['high', undefined])
  })

  it('should stop for tool use when a message calls a tool', () => {
    expect(assistantMessage([toolUse('echo', { x: 1 })]).stopReason).toBe('toolUse')
    expect(assistantMessage('done').stopReason).toBe('stop')
    expect(assistantMessage([toolUse('echo', {})], { stopReason: 'stop' }).stopReason).toBe('stop')
  })
})

// Helpers

/** One call through the catalog, as the agent makes it: the system prompt apart, the level only when thinking. */
async function ask(fake: FakeModel, text: string, options: { system?: string; reasoning?: 'high' } = {}) {
  const messages = [{ role: 'user' as const, content: text, timestamp: 0 }]
  const context = { systemPrompt: options.system, messages }
  return models.completeSimple(fake.model, context, { reasoning: options.reasoning })
}
