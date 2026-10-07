// Logging in from the terminal: the commands, and what /login does with the answers
import type { AuthInteraction, AuthPrompt } from '@ji.dev/llm'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findModel } from '@ji.dev/llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAuthFeature } from '../src/features/auth.ts'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('createAuthFeature', () => {
  it('should list /login and /logout, each taking a provider', async () => {
    // Act
    const feature = createAuthFeature(
      await tempDir(),
      answering(() => 'x'),
    )

    // Assert
    expect(feature.commands?.map(c => [c.name, c.arg])).toEqual([
      ['/login', '<provider>'],
      ['/logout', '<provider>'],
    ])
    expect(feature.plugin.name).toBe('auth')
  })

  it('should log in with the one method a provider has, without asking which', async () => {
    // Arrange
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    const asked: AuthPrompt[] = []
    const feature = createAuthFeature(
      await tempDir(),
      answering(p => {
        asked.push(p)
        return 'sk-typed'
      }),
    )

    // Act
    await feature.login('deepseek')

    // Assert
    expect(asked.map(p => p.type)).toEqual(['secret'])
    expect(await findModel('deepseek/deepseek-flash').hasKey()).toBe(true)
  })

  it('should ask which method when the provider has two, and stop at an unknown provider', async () => {
    // Arrange
    const asked: AuthPrompt[] = []
    const feature = createAuthFeature(
      await tempDir(),
      answering(p => {
        asked.push(p)
        return p.type === 'select' ? 'api_key' : 'sk-typed'
      }),
    )

    // Act
    await feature.login('openai')
    await feature.login('nope')

    // Assert
    expect(asked.map(p => p.type)).toEqual(['select', 'secret'])
    expect(asked[0]).toMatchObject({ options: [{ id: 'oauth' }, { id: 'api_key' }] })
  })
})

// Helpers

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'ji-auth-'))
}

function answering(answer: (p: AuthPrompt) => string): AuthInteraction {
  return { prompt: async p => answer(p), notify: () => {} }
}
