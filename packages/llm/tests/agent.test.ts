// createAgent: the model and thinking level are checked where they are chosen (RFC-0005 §6, laws C1 and C2).
import type { ThinkingLevel } from '../src/types.ts'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { createAgent } from '../src/agent.ts'
import { listModels, UnknownModelError, UnsupportedThinkingError } from '../src/models.ts'

const levels: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']
const catalog = fc.constantFrom(...listModels())

describe('createAgent', () => {
  it('should take a provider/id string and expose the resolved model and thinking level', () => {
    // Act
    const agent = createAgent({ model: 'deepseek/deepseek-v4-flash', thinking: 'high' })

    // Assert
    expect(agent.model).toMatchObject({ provider: 'deepseek', id: 'deepseek-v4-flash' })
    expect(agent.model.thinkingLevels).toEqual(['off', 'high', 'xhigh'])
    expect(agent.thinking).toBe('high')
  })

  it('should reject an unknown model when the agent is created, not at the first request', () => {
    // Act
    const create = (): unknown => createAgent({ model: 'deepseek/deepseek-v5' })

    // Assert
    expect(create).toThrow(UnknownModelError)
  })

  it('should reject a thinking level the model does not accept, naming the ones it does', () => {
    // Act
    const create = (): unknown => createAgent({ model: 'deepseek/deepseek-v4-flash', thinking: 'medium' })

    // Assert
    expect(create).toThrow(UnsupportedThinkingError)
    expect(create).toThrow('deepseek/deepseek-v4-flash does not support thinking "medium". Supported: off, high, xhigh')
  })

  it('should always accept a level exactly when the model lists it', () => {
    fc.assert(
      fc.property(catalog, fc.constantFrom(...levels), (model, thinking) => {
        // Act
        const create = (): unknown => createAgent({ model, thinking })

        // Assert
        if (model.thinkingLevels.includes(thinking)) {
          expect(create).not.toThrow()
        } else {
          expect(create).toThrow(UnsupportedThinkingError)
        }
      }),
    )
  })

  it('should always default to a level the model accepts, off whenever it can', () => {
    fc.assert(
      fc.property(catalog, model => {
        // Act
        const { thinking } = createAgent({ model })

        // Assert
        expect(model.thinkingLevels).toContain(thinking)
        expect(thinking === 'off').toBe(model.thinkingLevels.includes('off'))
      }),
    )
  })
})

describe('agent.with', () => {
  it('should return a new agent with the patch applied and leave the original as it was', () => {
    // Arrange
    const agent = createAgent({ model: 'deepseek/deepseek-v4-flash' })

    // Act
    const thinker = agent.with({ thinking: 'xhigh' })

    // Assert
    expect(thinker.thinking).toBe('xhigh')
    expect(agent.thinking).toBe('off')
    expect(thinker).not.toBe(agent)
  })

  it('should check the patch like createAgent does', () => {
    // Arrange
    const agent = createAgent({ model: 'deepseek/deepseek-v4-flash' })

    // Act
    const patch = (): unknown => agent.with({ thinking: 'low' })

    // Assert
    expect(patch).toThrow(UnsupportedThinkingError)
  })

  it('should always equal creating the agent from the merged options', () => {
    fc.assert(
      fc.property(
        catalog.chain(model => fc.tuple(fc.constant(model), fc.constantFrom(...model.thinkingLevels))),
        ([model, thinking]) => {
          // Arrange
          const agent = createAgent({ model })

          // Act
          const patched = agent.with({ thinking })
          const direct = createAgent({ model, thinking })

          // Assert
          expect([patched.model.id, patched.thinking]).toEqual([direct.model.id, direct.thinking])
        },
      ),
    )
  })
})
