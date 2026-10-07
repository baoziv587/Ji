// Fast mode: the priority tier goes into the request body of OpenAI's models, and nobody else's
import type { Api, Model } from '@ji.dev/llm'
import { describe, expect, it } from 'vitest'
import { requestFastTier, supportsFastMode } from '../src/agent/fast.ts'

describe('requestFastTier', () => {
  it('should ask for the priority tier on the OpenAI API and the Codex backend, keeping the rest', () => {
    // Arrange
    const payload = { model: 'gpt-6.1-sol', stream: true }

    // Act
    const api = requestFastTier(payload, model('openai'))
    const codex = requestFastTier(payload, model('openai-codex'))

    // Assert
    expect(api).toEqual({ model: 'gpt-6.1-sol', stream: true, service_tier: 'priority' })
    expect(codex).toEqual(api)
    expect(payload).not.toHaveProperty('service_tier')
  })

  it("should leave another provider's request as it is", () => {
    // Act
    const result = requestFastTier({ model: 'deepseek-flash' }, model('deepseek'))

    // Assert
    expect(result).toBeUndefined()
    expect(supportsFastMode(model('deepseek'))).toBe(false)
  })
})

function model(provider: string): Model<Api> {
  return { provider } as Model<Api>
}
