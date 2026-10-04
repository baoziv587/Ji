// What the line above the status says the session has spent
import type { Usage } from '@ji.dev/llm'
import { describe, expect, it } from 'vitest'
import { count, Meter } from '../src/usage.ts'

function usage(input: number, output: number, cacheRead: number, cost: number): Usage {
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost }
  return { input, output, cacheRead, cacheWrite: 0, totalTokens: input + output + cacheRead, cost: totals }
}

describe('meter', () => {
  it('should say nothing before any call has ended', () => {
    // Act
    const parts = new Meter().parts()

    // Assert
    expect(parts).toEqual([])
  })

  it('should add up every call, failed and untimed ones too, with cache hits out of all that was sent', () => {
    // Arrange
    const meter = new Meter()

    // Act
    meter.start()
    meter.end(usage(1000, 200, 3000, 0.01))
    meter.dropped(usage(500, 0, 500, 0.002))

    // Assert
    const [tokens, cache, ...rest] = meter.parts()
    expect(tokens).toBe('in 5k · out 200')
    expect(cache).toBe('cache 70%')
    expect(rest.at(-1)).toBe('$0.0120')
  })

  it('should leave the speed out until a started call has ended', () => {
    // Arrange
    const meter = new Meter()

    // Act
    meter.end(usage(10, 10, 0, 0))

    // Assert
    expect(meter.parts().some(part => part.endsWith('tok/s'))).toBe(false)
  })
})

describe('count', () => {
  it('should shorten thousands and millions, with one decimal below 100', () => {
    // Act
    const shown = [950, 1000, 1234, 48_200, 312_400, 1_500_000].map(count)

    // Assert
    expect(shown).toEqual(['950', '1k', '1.2k', '48.2k', '312k', '1.5M'])
  })
})
