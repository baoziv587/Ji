import type { AgentTool, Api, HookContext, Model, Payload, PluginList, RunEvent, ToolCall } from '@ji.dev/llm'
import { answerAll, recorder } from '@ji.dev/kernel/testing'
import { createAgent, createSession, tool, toolResult, Type } from '@ji.dev/llm'
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from '@mariozechner/pi-ai'
import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'
import { throttleUpdates } from '../src/index.ts'

describe('throttleUpdates', () => {
  it('should let through one update per call every ms and drop the ones in between', async () => {
    // Arrange: updates at 0, 40, 90, 120 ms
    const clock = scriptedClock([0, 40, 90, 120])
    const plugin = throttleUpdates({ ms: 100, now: clock })

    // Act
    const events = await run(updatingTool([0, 1, 2, 3]), [plugin])

    // Assert
    expect(updatesOf(events)).toEqual([0, 3])
  })

  it('should keep tool_start, tool_end and the result as they were', async () => {
    // Arrange
    const plugin = throttleUpdates({ ms: 100, now: () => 0 })

    // Act
    const events = await run(updatingTool([0, 1, 2]), [plugin])

    // Assert
    expect(events.filter(e => e.type.startsWith('tool_') && e.type !== 'tool_update').map(e => e.type)).toEqual([
      'tool_call',
      'tool_start',
      'tool_end',
    ])
    expect(events.find(e => e.type === 'tool_end')).toMatchObject({ result: { isError: false } })
  })

  it('should always keep updates in order, never closer than ms apart, and always keep the first', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.nat()), fc.nat(), async (gaps, ms) => {
        // Arrange: update i happens at the sum of the first i gaps
        const times = gaps.map((_, i) => gaps.slice(0, i + 1).reduce((a, b) => a + b, 0))
        const plugin = throttleUpdates({ ms, now: scriptedClock(times) })

        // Act
        const kept = updatesOf(await run(updatingTool(times.map((_, i) => i)), [plugin]))

        // Assert
        expect(kept).toEqual(kept.toSorted((a, b) => a - b))
        expect(kept[0]).toBe(times.length > 0 ? 0 : undefined)
        kept.slice(1).forEach((i, k) => {
          expect(times[i] - times[kept[k]]).toBeGreaterThanOrEqual(ms)
        })
      }),
      { numRuns: 50 },
    )
  })

  it('should hand replies back to the events it lets through, and none to the updates it drops (I15)', async () => {
    // Arrange: updates at 0, 40, 120 ms around a plugin event
    const call: ToolCall = { type: 'toolCall', id: 'c', name: 'updating', arguments: {} }
    const update = (data: number): Payload => ({ type: 'tool_update', call, data })
    const deltas: Payload[] = [update(0), update(1), { type: 'tool_start', call }, update(2)]
    const inner = recorder(deltas, toolResult(call, 'done'))
    const toolCall = throttleUpdates({ ms: 100, now: scriptedClock([0, 40, 120]) }).toolCall!

    // Act
    const { sent } = await answerAll(
      toolCall(call, () => inner.stream, {} as HookContext),
      (_, i) => `reply ${i}`,
    )

    // Assert
    expect(sent).toHaveLength(3)
    expect(inner.got.map(x => x.reply)).toEqual(['reply 0', undefined, 'reply 1', 'reply 2'])
  })
})

// Helpers

const registrations: Array<{ unregister: () => void }> = []
afterEach(() => {
  registrations.splice(0).forEach(r => r.unregister())
})

/** Returns the given times in order, one per call. */
function scriptedClock(times: number[]): () => number {
  let i = 0
  return () => times[i++]
}

/** Yields each value as an update, then returns 'done'. */
function updatingTool(values: number[]): AgentTool {
  return tool({
    name: 'updating',
    description: 'yields updates',
    parameters: Type.Object({}),
    async *run() {
      yield* values
      return 'done'
    },
  })
}

async function run(t: AgentTool, plugins: PluginList): Promise<RunEvent[]> {
  const chat = createSession(createAgent({ model: faux(), tools: [t], plugins }))
  const events: RunEvent[] = []
  for await (const e of chat.send('go')) {
    events.push(e)
  }
  return events
}

function faux(): Model<Api> {
  const registration = registerFauxProvider()
  registration.setResponses([
    fauxAssistantMessage([fauxToolCall('updating', {})], { stopReason: 'toolUse' }),
    fauxAssistantMessage('ok'),
  ])
  registrations.push(registration)
  return registration.getModel()
}

/** The tools here yield numbers only. */
function updatesOf(events: RunEvent[]): number[] {
  return events.flatMap(e => (e.type === 'tool_update' ? [e.data as number] : []))
}
