// findModel / listModels: resolving 'provider/id' against pi-ai's catalog, and errors a model picker can use.
import fc from 'fast-check'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { findModel, listModels, UnknownModelError } from '../src/models.ts'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('findModel', () => {
  it('should resolve provider/id to that model with the thinking levels it accepts', () => {
    // Act
    const model = findModel('deepseek/deepseek-flash')

    // Assert
    expect(model).toMatchObject({ provider: 'deepseek', id: 'deepseek-flash' })
    expect(model.thinkingLevels).toEqual(['off', 'low', 'high', 'max'])
  })

  it('should suggest the closest model when the id has a typo', () => {
    // Act
    const failure = catchError(() => findModel('deepseek/deepseek-v4-flsh'))

    // Assert
    expect(failure).toBeInstanceOf(UnknownModelError)
    expect(failure).toMatchObject({ suggestion: 'deepseek/deepseek-flash' })
    expect(failure.message).toContain('Did you mean "deepseek/deepseek-flash"?')
    expect(failure.message).toContain('deepseek/deepseek-v4-pro')
  })

  it('should suggest the closest provider when the provider has a typo', () => {
    // Act
    const failure = catchError(() => findModel('deepsek/deepseek-flash'))

    // Assert
    expect(failure).toMatchObject({ suggestion: 'deepseek/deepseek-flash' })
  })

  it('should not suggest anything for a name far from every model', () => {
    // Act
    const failure = catchError(() => findModel('deepseek/a-model-that-does-not-exist-anywhere'))

    // Assert
    expect(failure).toMatchObject({ suggestion: undefined })
    expect(failure.message).not.toContain('Did you mean')
  })

  it('should resolve a bare id offered by exactly one provider', () => {
    // Act
    const model = findModel('amazon.nova-pro-v1:0')

    // Assert
    expect(model).toMatchObject({ provider: 'amazon-bedrock', id: 'amazon.nova-pro-v1:0' })
  })

  it('should ask for the provider when several providers offer a bare id', () => {
    // Act
    const failure = catchError(() => findModel('deepseek-v4-pro'))

    // Assert
    expect(failure).toBeInstanceOf(UnknownModelError)
    expect(failure.message).toContain('write it as provider/id')
    expect((failure as UnknownModelError).available).toContain('deepseek/deepseek-v4-pro')
  })

  it('should always resolve every catalog model from its provider/id', () => {
    fc.assert(
      fc.property(fc.constantFrom(...listModels()), model => {
        // Act
        const found = findModel(`${model.provider}/${model.id}`)

        // Assert
        expect([found.provider, found.id]).toEqual([model.provider, model.id])
        expect(found.thinkingLevels.length).toBeGreaterThan(0)
      }),
    )
  })

  it('should always resolve a bare id when unique and name every provider when not', () => {
    // An id with a slash is read as provider/id, so only slash-free ids are bare
    const byId = Map.groupBy(
      listModels().filter(m => !m.id.includes('/')),
      m => m.id,
    )

    fc.assert(
      fc.property(fc.constantFrom(...byId.keys()), id => {
        // Arrange
        const offers = byId.get(id)!

        // Act
        const outcome = attempt(() => findModel(id))

        // Assert
        if (offers.length === 1) {
          expect(outcome).toMatchObject({ provider: offers[0].provider, id })
        } else {
          expect(outcome).toBeInstanceOf(UnknownModelError)
          expect((outcome as UnknownModelError).available.toSorted()).toEqual(
            offers.map(m => `${m.provider}/${m.id}`).toSorted(),
          )
        }
      }),
    )
  })

  it('should always offer a suggestion that exists when one character of a model id is dropped', () => {
    const specs = new Set(listModels().map(m => `${m.provider}/${m.id}`))
    const typo = fc
      .constantFrom(...listModels())
      .chain(m => fc.nat({ max: m.id.length - 1 }).map(i => `${m.provider}/${m.id.slice(0, i)}${m.id.slice(i + 1)}`))

    fc.assert(
      fc.property(typo, spec => {
        fc.pre(!specs.has(spec))

        // Act
        const failure = catchError(() => findModel(spec))

        // Assert
        expect(failure).toBeInstanceOf(UnknownModelError)
        expect(specs.has((failure as UnknownModelError).suggestion!)).toBe(true)
      }),
    )
  })
})

describe('listModels', () => {
  it('should list only the models of the given provider', () => {
    // Act
    const models = listModels('deepseek')

    // Assert
    expect(models.map(m => m.id)).toEqual(['deepseek-flash', 'deepseek-v4-pro'])
  })

  it('should tell whether the provider has a key when asked, not when listed', async () => {
    // Arrange
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    const [model] = listModels('deepseek')
    const before = await model.hasKey()

    // Act
    vi.stubEnv('DEEPSEEK_API_KEY', 'sk-test')

    // Assert
    expect(before).toBe(false)
    expect(await model.hasKey()).toBe(true)
  })
})

// Helpers

function attempt<T>(f: () => T): T | unknown {
  try {
    return f()
  } catch (error) {
    return error
  }
}

function catchError(f: () => unknown): Error {
  const outcome = attempt(f)
  if (!(outcome instanceof Error)) {
    throw new TypeError('expected an error')
  }
  return outcome
}
