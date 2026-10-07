import { createAgent, createSession } from '@ji.dev/llm'
import { describe, expect, it, onTestFinished } from 'vitest'
import { assistantMessage, createFakeModel, textBlock, toolUse } from '../src/index.ts'

describe('createFakeModel', () => {
  it('should give the scripted replies in order and count the calls', async () => {
    // Arrange
    const fake = createFakeModel([assistantMessage('one'), assistantMessage('two')])
    onTestFinished(fake.dispose)
    const session = createSession(createAgent({ model: fake.model }))

    // Act
    const first = await session.send('a').result
    const second = await session.send('b').result

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
    const agent = createAgent({ model: fake.model, system: 'be brief' })

    // Act
    await createSession(agent).send('go').result

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
    await createSession(createAgent({ model: thinker.model, thinking: 'high' })).send('go').result
    await createSession(createAgent({ model: plain.model })).send('go').result

    // Assert
    expect(levels).toEqual(['high', undefined])
  })

  it('should stop for tool use when a message calls a tool', () => {
    expect(assistantMessage([toolUse('echo', { x: 1 })]).stopReason).toBe('toolUse')
    expect(assistantMessage('done').stopReason).toBe('stop')
    expect(assistantMessage([toolUse('echo', {})], { stopReason: 'stop' }).stopReason).toBe('stop')
  })
})
