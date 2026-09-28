import { afterEach, describe, expect, it, vi } from 'vitest'
import { isDevEnv, warn } from '../src/runtime.ts'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('isDevEnv', () => {
  it('should be on only for development and test', () => {
    const cases = { development: true, test: true, production: false, '': false }

    for (const [env, expected] of Object.entries(cases)) {
      vi.stubEnv('NODE_ENV', env)
      expect(isDevEnv()).toBe(expected)
    }
  })

  it('should be off where there is no process', () => {
    vi.stubGlobal('process', undefined)

    expect(isDevEnv()).toBe(false)
  })
})

describe('warn', () => {
  it('should emit a process warning of the given type in Node', () => {
    // Arrange
    const emitWarning = vi.spyOn(process, 'emitWarning').mockImplementation(() => {})

    // Act
    warn('careful', 'SomeWarning')

    // Assert
    expect(emitWarning).toHaveBeenCalledWith('careful', 'SomeWarning')
  })

  it('should fall back to console.error where there is no process', () => {
    // Arrange
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('process', undefined)

    // Act
    warn('careful', 'SomeWarning')

    // Assert
    expect(error).toHaveBeenCalledWith('SomeWarning: careful')
  })
})
