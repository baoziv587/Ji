import type { AgentTool, Api, JsonValue, Model, Plugin, PluginList, ToolResultMessage } from '@ji.dev/llm'
import { createAgent, createSession, definePlugin, tool, Type } from '@ji.dev/llm'
import { assistantMessage, createFakeModel, toolUse } from '@ji.dev/testing'
import fc from 'fast-check'
import { describe, expect, it, onTestFinished } from 'vitest'
import { createTruncateToolResultsPlugin, truncateText } from '../src/index.ts'

describe('truncateText', () => {
  it('should leave text within the limit as it is', () => {
    expect(truncateText('small', 1_000)).toBe('small')
  })

  it('should keep the head and the tail, and say how much was omitted', () => {
    // Arrange
    const text = `${'a'.repeat(5_000)}${'b'.repeat(5_000)}`

    // Act
    const short = truncateText(text, 1_000)

    // Assert
    expect(short.startsWith('aaa')).toBe(true)
    expect(short.endsWith('bbb')).toBe(true)
    expect(short).toMatch(/\[\.\.\. \d+ characters \(0 lines\) omitted/)
  })

  it('should cut at line boundaries when they are near', () => {
    // Arrange: 1000 lines of 9 characters and a newline
    const text = Array.from({ length: 1_000 }, (_, i) => `line ${String(i).padStart(4, '0')}`).join('\n')

    // Act
    const [head, tail] = truncateText(text, 1_000).split(/\n\[\.\.\. .* \.\.\.\]\n/)

    // Assert: every kept line is whole
    expect(head.split('\n').every(line => /^line \d{4}$/.test(line) || line === '')).toBe(true)
    expect(tail.split('\n').every(line => /^line \d{4}$/.test(line))).toBe(true)
  })

  it('should always stay within maxChars and keep a prefix and a suffix of the text', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: 'binary', maxLength: 3_000 }),
        fc.integer({ min: 200, max: 2_000 }),
        (text, max) => {
          // Act
          const short = truncateText(text, max)

          // Assert
          if (text.length <= max) {
            expect(short).toBe(text)
            return
          }
          expect(short.length).toBeLessThanOrEqual(max)
          const [head, tail] = short.split(/\n\[\.\.\. [^\]]* \.\.\.\]\n/)
          expect(text.startsWith(head)).toBe(true)
          expect(text.endsWith(tail)).toBe(true)
        },
      ),
    )
  })

  it('should never split a surrogate pair', () => {
    // Arrange: every character is a pair
    const text = '😀'.repeat(2_000)

    // Act
    const short = truncateText(text, 1_001)

    // Assert
    expect(short.isWellFormed()).toBe(true)
  })
})

describe('createTruncateToolResultsPlugin', () => {
  it('should cut what the model gets and record the original length in details', async () => {
    // Arrange
    const plugin = createTruncateToolResultsPlugin({ maxChars: 500 })

    // Act
    const result = await runOnce(textTool('x'.repeat(5_000), { exitCode: 0 }), [plugin])

    // Assert
    expect(textLength(result)).toBeLessThanOrEqual(500)
    expect(result.details).toEqual({ exitCode: 0, truncated: { originalChars: 5_000 } })
  })

  it('should hold the limit for all text blocks together', async () => {
    // Arrange: a tool whose result has several blocks, each under the limit
    const plugin = createTruncateToolResultsPlugin({ maxChars: 500 })
    const blocks = textTool('y'.repeat(400))

    // Act
    const result = await runOnce(blocks, [plugin, splitInto(4)])

    // Assert
    expect(textLength(result)).toBeLessThanOrEqual(500)
    expect(result.content.filter(c => c.type === 'text')).toHaveLength(1)
  })

  it('should leave a result within the limit untouched', async () => {
    // Arrange
    const plugin = createTruncateToolResultsPlugin({ maxChars: 500 })

    // Act
    const result = await runOnce(textTool('short'), [plugin])

    // Assert
    expect(result.content).toEqual([{ type: 'text', text: 'short' }])
    expect(result.details).toBeUndefined()
  })

  it('should refuse a limit with no room for the note', () => {
    expect(() => createTruncateToolResultsPlugin({ maxChars: 100 })).toThrow(RangeError)
  })
})

function textTool(text: string, details?: JsonValue): AgentTool {
  return tool({
    name: 'dump',
    description: 'returns a lot of text',
    parameters: Type.Object({}),
    run: () => ({ text, details }),
  })
}

/** Inner to the plugin under test: splits the result's text into `n` blocks of `text`'s full length each. */
function splitInto(n: number): Plugin {
  return definePlugin({
    name: 'split',
    async *toolCall(call, next) {
      const result = yield* next(call)
      const text = result.content.flatMap(c => (c.type === 'text' ? [c.text] : [])).join('')
      return { ...result, content: Array.from({ length: n }, () => ({ type: 'text' as const, text })) }
    },
  })
}

function textLength(result: ToolResultMessage): number {
  return result.content.reduce((n, c) => n + (c.type === 'text' ? c.text.length : 0), 0)
}

async function runOnce(t: AgentTool, plugins: PluginList): Promise<ToolResultMessage> {
  const chat = createSession(createAgent({ model: faux(t.name), tools: [t], plugins }))
  const state = await chat.send('go').state
  return state.messages.find(m => m.role === 'toolResult')!
}

function faux(name: string): Model<Api> {
  const fake = createFakeModel([assistantMessage([toolUse(name, {})]), assistantMessage('ok')])
  onTestFinished(() => fake.dispose())
  return fake.model
}
