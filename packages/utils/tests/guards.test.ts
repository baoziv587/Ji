import { describe, expect, it } from 'vitest'
import { errorMessage } from '../src/error.ts'
import { isAsyncIterable, isThenable } from '../src/guards.ts'

describe('isThenable', () => {
  it('should accept promises and objects with a then method', () => {
    expect(isThenable(Promise.resolve())).toBe(true)
    expect(isThenable({ then: () => {} })).toBe(true)
  })

  it('should reject anything without a callable then', () => {
    for (const value of [undefined, null, 1, 'then', { then: 1 }, () => {}]) {
      expect(isThenable(value)).toBe(false)
    }
  })
})

describe('isAsyncIterable', () => {
  it('should accept async generators', () => {
    async function* gen(): AsyncGenerator<number> {
      yield 1
    }

    expect(isAsyncIterable(gen())).toBe(true)
  })

  it('should reject sync iterables, promises and primitives', () => {
    for (const value of [[1], 'text', Promise.resolve(), null, undefined]) {
      expect(isAsyncIterable(value)).toBe(false)
    }
  })
})

describe('errorMessage', () => {
  it('should take the message of an Error and stringify anything else', () => {
    expect(errorMessage(new TypeError('bad'))).toBe('bad')
    expect(errorMessage('plain')).toBe('plain')
    expect(errorMessage(42)).toBe('42')
  })
})
