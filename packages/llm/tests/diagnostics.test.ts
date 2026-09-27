// Development checks (RFC-0006 §8): freezing committed state and comparing reducer results as plain data.
import { isDeepStrictEqual } from 'node:util'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { deepFreeze, sameData } from '../src/diagnostics.ts'

describe('deepFreeze', () => {
  it('should always freeze every plain object and array inside, and give the same value back', () => {
    fc.assert(
      fc.property(fc.jsonValue(), value => {
        // Act
        const frozen = deepFreeze(value)

        // Assert
        expect(frozen).toBe(value)
        expect(containers(value).every(c => Object.isFrozen(c))).toBe(true)
      }),
    )
  })

  it('should throw where a nested write happens', () => {
    // Arrange
    const state = deepFreeze({ counts: { model: 0 }, list: [1] })

    // Act
    const writes = [() => state.counts.model++, () => state.list.push(2)]

    // Assert
    for (const write of writes) {
      expect(write).toThrow(TypeError)
    }
  })

  it('should leave class instances, maps and sets as they are', () => {
    // Arrange
    const map = new Map([['k', { v: 1 }]])
    const date = new Date(0)

    // Act
    deepFreeze({ map, date })

    // Assert
    expect(Object.isFrozen(map)).toBe(false)
    expect(Object.isFrozen(date)).toBe(false)
    expect(Object.isFrozen(map.get('k'))).toBe(false)
  })
})

describe('sameData', () => {
  it('should always find a value equal to its structured clone', () => {
    fc.assert(
      fc.property(fc.jsonValue(), value => {
        expect(sameData(value, structuredClone(value))).toBe(true)
      }),
    )
  })

  it('should always agree with a deep strict equality check on plain data', () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.jsonValue(), (a, b) => {
        expect(sameData(a, b)).toBe(isDeepStrictEqual(a, b))
      }),
    )
  })

  it('should tell an array from an object with the same keys', () => {
    expect(sameData([1], { 0: 1 })).toBe(false)
  })
})

/** Every object and array in a JSON value, itself included. */
function containers(value: unknown): object[] {
  if (typeof value !== 'object' || value === null) {
    return []
  }
  return [value, ...Object.values(value).flatMap(containers)]
}
