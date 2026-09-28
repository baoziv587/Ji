import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { closest, editDistance } from '../src/string.ts'

const words = fc.string({ maxLength: 12 })

describe('editDistance', () => {
  it('should always be zero exactly for equal strings', () => {
    fc.assert(
      fc.property(words, words, (a, b) => {
        expect(editDistance(a, b) === 0).toBe(a === b)
      }),
    )
  })

  it('should always be symmetric', () => {
    fc.assert(
      fc.property(words, words, (a, b) => {
        expect(editDistance(a, b)).toBe(editDistance(b, a))
      }),
    )
  })

  it('should always satisfy the triangle inequality', () => {
    fc.assert(
      fc.property(words, words, words, (a, b, c) => {
        expect(editDistance(a, c)).toBeLessThanOrEqual(editDistance(a, b) + editDistance(b, c))
      }),
    )
  })

  it('should count one edit per inserted, deleted or substituted character', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3)
  })
})

describe('closest', () => {
  it('should pick the candidate a typo came from', () => {
    expect(closest('gtp-4o', ['gpt-4o', 'o3', 'claude'])).toBe('gpt-4o')
  })

  it('should give nothing when no candidate is close enough to be a typo', () => {
    expect(closest('llama', ['gpt-4o', 'o3'])).toBeUndefined()
  })

  it('should compare by key but return the whole candidate', () => {
    // Act
    const found = closest('gpt-4', ['openai/gpt-4o', 'anthropic/claude'], c => c.slice(c.indexOf('/') + 1))

    // Assert
    expect(found).toBe('openai/gpt-4o')
  })

  it('should always return one of the candidates or nothing', () => {
    fc.assert(
      fc.property(words, fc.array(words), (target, candidates) => {
        const found = closest(target, candidates)
        expect(found === undefined || candidates.includes(found)).toBe(true)
      }),
    )
  })
})
