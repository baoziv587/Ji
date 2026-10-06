// What the line above the status says: how much the history holds, then what the session has spent
import type { Usage } from '@ji.dev/llm'
import { describe, expect, it } from 'vitest'
import { Meter } from '../src/ui/usage.ts'

const LIMIT = 200_000

function usage(input: number, output: number, cacheRead: number, cost: number): Usage {
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost }
  return { input, output, cacheRead, cacheWrite: 0, totalTokens: input + output + cacheRead, cost: totals }
}

describe('meter', () => {
  it('should add up every call, failed and untimed ones too, with cache hits out of all that was sent', () => {
    // Arrange
    const meter = new Meter()

    // Act
    meter.start()
    meter.end(usage(1000, 200, 3000, 0.01))
    meter.dropped(usage(500, 0, 500, 0.002))

    // Assert: no main-model answer was measured, so no history size
    const [cost, tokens, cache] = meter.parts(LIMIT)
    expect(cost).toBe('$0.0120')
    expect(tokens).toBe('in 5k · out 200')
    expect(cache).toBe('cache 70%')
  })

  it('should put the history first, as the main model last counted it', () => {
    // Arrange
    const meter = new Meter()

    // Act
    meter.end(usage(1000, 200, 3000, 0.01))
    meter.measured(usage(1000, 200, 3000, 0.01))

    // Assert
    expect(meter.parts(LIMIT)[0]).toBe('ctx 4.2k/200k')
  })

  it('should mark the size after a compaction as an estimate until the main model counts it', () => {
    // Arrange
    const meter = new Meter()
    meter.end(usage(150_000, 0, 0, 0))
    meter.measured(usage(150_000, 0, 0, 0))

    // Act
    meter.compacted(31_000)
    const estimated = meter.parts(LIMIT)[0]
    meter.measured(usage(30_000, 500, 0, 0))

    // Assert
    expect(estimated).toBe('ctx ~31k/200k')
    expect(meter.parts(LIMIT)[0]).toBe('ctx 30.5k/200k')
  })
})

describe('summary', () => {
  it('should formatCount every token for the exit, with the calls and the cost', () => {
    // Arrange
    const meter = new Meter()

    // Act
    meter.end(usage(1000, 200, 3000, 0.01))
    meter.dropped(usage(500, 0, 500, 0.002))

    // Assert
    expect(meter.summary()).toBe('Tokens: 5,000 in (70% cached) · 200 out · 2 model calls · $0.0120')
  })
})
