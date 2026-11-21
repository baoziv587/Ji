// What /autocompact takes: a number of tokens, with a k or m, commas or neither, or default; and where that leaves the
// history compacted, never past the model's context window
import { describe, expect, it } from 'vitest'
import { contextLimitOf } from '../src/agent/agent.ts'
import { MIN_COMPACT_AT, parseCompactAt } from '../src/agent/autocompact.ts'

describe('parseCompactAt', () => {
  it.each([
    ['400k', 400_000],
    ['400K', 400_000],
    ['1.5m', 1_500_000],
    ['400000', 400_000],
    ['400,000', 400_000],
    [' 250 k ', 250_000],
  ])('should read %j as %d tokens', (text, tokens) => {
    expect(parseCompactAt(text)).toBe(tokens)
  })

  it('should read default as no setting', () => {
    expect(parseCompactAt('default')).toBeUndefined()
  })

  it('should refuse what is no number of tokens, and too few of them', () => {
    expect(() => parseCompactAt('lots')).toThrow('is not a number of tokens')
    expect(() => parseCompactAt('-5k')).toThrow('is not a number of tokens')
    expect(() => parseCompactAt('5k')).toThrow(`below ${MIN_COMPACT_AT.toLocaleString('en-US')}`)
  })
})

describe('contextLimitOf', () => {
  it('should compact where it is set, short of the context window, and by the default without a setting', () => {
    const model = { contextWindow: 272_000 }

    expect(contextLimitOf(model, 150_000)).toBe(150_000)
    expect(contextLimitOf(model, 400_000)).toBe(272_000)
    expect(contextLimitOf(model)).toBe(200_000)
    expect(contextLimitOf({ contextWindow: 1_000_000 }, 400_000)).toBe(400_000)
  })
})
