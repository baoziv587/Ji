// toolRunner: a plain run returns its text; a generator run streams tool_update events and returns its result.
import type { Stream } from '@gaoxiang.ai/kernel'
import type { ToolCall } from '@mariozechner/pi-ai'
import type { AgentTool, Payload } from './types.ts'
import { Type } from '@mariozechner/pi-ai'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { tool, toolRunner } from './tool.ts'

const call: ToolCall = { type: 'toolCall', id: 'call-1', name: 'count', arguments: {} }

describe('toolRunner', () => {
  it('should turn what a plain tool returns into a result, with no update', async () => {
    // Arrange
    const run = toolRunner([counting(async () => 'three')])

    // Act
    const { deltas, result } = await drain(run({ call, signal: new AbortController().signal }))

    // Assert
    expect(deltas).toEqual([])
    expect(result).toMatchObject({ toolCallId: 'call-1', isError: false, content: [{ text: 'three' }] })
  })

  it('should stream each value a generator tool yields as a tool_update and return what it returns', async () => {
    // Arrange
    const run = toolRunner([
      counting(async function* () {
        yield 1
        yield 'two'
        return 'counted'
      }),
    ])

    // Act
    const { deltas, result } = await drain(run({ call, signal: new AbortController().signal }))

    // Assert
    expect(deltas).toEqual([
      { type: 'tool_update', call, data: 1 },
      { type: 'tool_update', call, data: 'two' },
    ])
    expect(result).toMatchObject({ isError: false, content: [{ text: 'counted' }] })
  })

  it('should rethrow what the tool throws, so outer middleware can retry or report it', async () => {
    // Arrange
    const run = toolRunner([
      counting(async function* () {
        yield 1
        throw new Error('count failed')
      }),
    ])

    // Act
    const outcome = drain(run({ call, signal: new AbortController().signal }))

    // Assert
    await expect(outcome).rejects.toThrow('count failed')
  })

  it('should always pass on any value the tool yields, unchanged and in order', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.anything()), async values => {
        // Arrange
        const run = toolRunner([
          counting(async function* () {
            yield* values
            return 'done'
          }),
        ])

        // Act
        const { deltas } = await drain(run({ call, signal: new AbortController().signal }))

        // Assert
        expect(deltas.map(d => d.type === 'tool_update' && d.data)).toEqual(values)
      }),
    )
  })

  it('should run the finally block of a generator tool when the stream is cancelled', async () => {
    // Arrange
    let closed = false
    const run = toolRunner([
      counting(async function* () {
        try {
          yield 1
          yield 2
          return 'never'
        } finally {
          closed = true
        }
      }),
    ])
    const stream = run({ call, signal: new AbortController().signal })

    // Act
    await stream.next()
    await stream.return(undefined as never)

    // Assert
    expect(closed).toBe(true)
  })
})

// Helpers

function counting(run: () => string | Promise<string> | Stream<unknown, string>): AgentTool {
  return tool({ name: 'count', description: 'counts', parameters: Type.Object({}), run })
}

async function drain<T>(stream: Stream<Payload, T>): Promise<{ deltas: Payload[]; result: T }> {
  const deltas: Payload[] = []
  for (;;) {
    const r = await stream.next()
    if (r.done) {
      return { deltas, result: r.value }
    }
    deltas.push(r.value)
  }
}
