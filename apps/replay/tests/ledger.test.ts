import type { AssistantMessage, RunEvent, ToolCall } from '@ji.dev/llm'
import { describe, expect, it } from 'vitest'
import { createLedger } from '../src/ledger.ts'

const call: ToolCall = { type: 'toolCall', id: 'c1', name: 'sh', arguments: { cmd: 'ls' } }
const message = { role: 'assistant' } as AssistantMessage
const model = { provider: 'faux', id: 'm' }

/** A well-formed run: one tool turn, then the answer. */
function wellFormed(): RunEvent[] {
  return [
    { t: 0, type: 'step_start' },
    { t: 0, type: 'model_start', model, thinking: 'off' },
    { t: 0, type: 'text', delta: 'hel' },
    { t: 0, type: 'tool_call', call },
    { t: 0, type: 'model_end', message, ms: 1 },
    { t: 0, type: 'tool_start', call },
    { t: 0, type: 'tool_update', call, data: 'x' },
    { t: 0, type: 'tool_end', call, result: {} as never, ms: 1 },
    { t: 0, type: 'step_end' } as RunEvent,
    { t: 1, type: 'step_start' },
    { t: 1, type: 'model_start', model, thinking: 'off' },
    { t: 1, type: 'text', delta: 'lo' },
    { t: 1, type: 'model_end', message, ms: 1 },
    { t: 1, type: 'step_end' } as RunEvent,
    { t: 2, type: 'run_end', outcome: 'done' } as RunEvent,
  ]
}

function scan(events: RunEvent[]): ReturnType<ReturnType<typeof createLedger>['finish']> {
  const ledger = createLedger()
  events.forEach(ledger.push)
  return ledger.finish()
}

describe('createLedger', () => {
  it('should accept a well-formed run and join its text', () => {
    // Act
    const summary = scan(wellFormed())

    // Assert
    expect(summary.violations).toEqual([])
    expect(summary.text).toBe('hello')
    expect(summary.events).toBe(15)
    expect(summary.byType.tool_end).toBe(1)
  })

  it('should give two identical sequences the same digest and a reordered one another', () => {
    // Arrange
    const events = wellFormed()
    const swapped = [...events]
    ;[swapped[5], swapped[6]] = [swapped[6], swapped[5]]

    // Act & Assert
    expect(scan(events).digest).toBe(scan(wellFormed()).digest)
    expect(scan(swapped).digest).not.toBe(scan(events).digest)
  })

  it.each([
    ['a second model call while one is open', 2, { t: 0, type: 'model_start', model, thinking: 'off' }, 'already open'],
    ['a tool the model never called', 5, { t: 0, type: 'tool_start', call: { ...call, id: 'ghost' } }, 'never called'],
    ['an event of another step', 3, { t: 1, type: 'text', delta: '' }, 'in step 0'],
    ['a step inside a step', 1, { t: 0, type: 'step_start' }, 'inside step'],
  ] as const)('should flag %s', (_, at, extra, message) => {
    // Arrange
    const events = wellFormed()
    events.splice(at, 0, extra as RunEvent)

    // Act
    const { violations } = scan(events)

    // Assert
    expect(violations.join('\n')).toContain(message)
  })

  it('should flag a run that never ended and a step left open', () => {
    // Act
    const { violations } = scan(wellFormed().slice(0, 10))

    // Assert
    expect(violations).toEqual(['run_end never came', 'step 1 never ended'])
  })

  it('should flag a step that ends with a tool still running', () => {
    // Arrange
    const events = wellFormed().filter(e => e.type !== 'tool_end')

    // Act
    const { violations } = scan(events)

    // Assert
    expect(violations.join('\n')).toContain('step ended with 1 tool calls open')
  })
})
