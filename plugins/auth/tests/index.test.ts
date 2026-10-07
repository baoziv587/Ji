// The file store: what it keeps, how two writers share it, and who can read it; the plugin's login and installation id
import type { AuthInteraction } from '@ji.dev/llm'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findModel } from '@ji.dev/llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  authMethodsOf,
  createAuthPlugin,
  createFileCredentialStore,
  installationIdOf,
  listLoginProviders,
  login,
} from '../src/index.ts'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('createFileCredentialStore', () => {
  it('should read back what modify stored, from another store on the same file too', async () => {
    // Arrange
    const file = await tempFile()
    const store = createFileCredentialStore(file)

    // Act
    const stored = await store.modify('deepseek', async () => ({ type: 'api_key', key: 'sk-test' }))
    const again = createFileCredentialStore(file)

    // Assert
    expect(stored).toEqual({ type: 'api_key', key: 'sk-test' })
    expect(await store.read('deepseek')).toEqual({ type: 'api_key', key: 'sk-test' })
    expect(await again.read('deepseek')).toEqual({ type: 'api_key', key: 'sk-test' })
    expect(await again.read('openai')).toBeUndefined()
  })

  it('should list providers and types without the secrets, and forget a deleted one', async () => {
    // Arrange
    const store = createFileCredentialStore(await tempFile())
    await store.modify('deepseek', async () => ({ type: 'api_key', key: 'sk-test' }))
    await store.modify('openai', async () => ({ type: 'oauth', access: 'a', refresh: 'r', expires: 1 }))

    // Act
    const before = await store.list()
    await store.delete('deepseek')
    await store.delete('never-there')

    // Assert
    expect(before).toEqual([
      { providerId: 'deepseek', type: 'api_key' },
      { providerId: 'openai', type: 'oauth' },
    ])
    expect(await store.list()).toEqual([{ providerId: 'openai', type: 'oauth' }])
  })

  it('should leave the credential as it is when modify returns undefined', async () => {
    // Arrange
    const store = createFileCredentialStore(await tempFile())
    await store.modify('deepseek', async () => ({ type: 'api_key', key: 'sk-test' }))

    // Act
    const result = await store.modify('deepseek', async () => undefined)

    // Assert
    expect(result).toEqual({ type: 'api_key', key: 'sk-test' })
  })

  it('should run modifies one after the other, each seeing the last one wrote', async () => {
    // Arrange
    const file = await tempFile()
    const stores = [createFileCredentialStore(file), createFileCredentialStore(file)]

    // Act
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        stores[i % 2].modify('openai', async current => ({
          type: 'oauth',
          access: 'a',
          refresh: 'r',
          expires: (current?.type === 'oauth' ? current.expires : 0) + 1,
        })),
      ),
    )

    // Assert
    expect(await stores[0].read('openai')).toMatchObject({ expires: 10 })
  })

  it('should make the file readable by its owner only', async () => {
    // Arrange
    const file = await tempFile()
    const store = createFileCredentialStore(file)

    // Act
    await store.modify('deepseek', async () => ({ type: 'api_key', key: 'sk-test' }))

    // Assert
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ deepseek: { type: 'api_key', key: 'sk-test' } })
  })

  it('should reject with the file named when it is not a map of credentials', async () => {
    // Arrange
    const file = await tempFile()
    const { writeFile } = await import('node:fs/promises')
    await writeFile(file, '[1]')

    // Act & Assert
    await expect(createFileCredentialStore(file).read('deepseek')).rejects.toThrow(file)
  })
})

describe('installationIdOf', () => {
  it('should make a UUID once and give the same one back', async () => {
    // Arrange
    const dir = await mkdtemp(join(tmpdir(), 'ji-auth-'))

    // Act
    const first = installationIdOf(dir)
    const second = installationIdOf(dir)

    // Assert
    expect(first).toMatch(/^[0-9a-f-]{36}$/)
    expect(second).toBe(first)
    expect((await stat(join(dir, 'installation-id'))).mode & 0o777).toBe(0o600)
  })
})

describe('authMethodsOf', () => {
  it('should list the ChatGPT sign-in before the key for openai, and nothing for an unknown provider', () => {
    // Act
    const openai = authMethodsOf('openai')

    // Assert
    expect(openai.map(m => m.type)).toEqual(['oauth', 'api_key'])
    expect(openai[0]).toMatchObject({ name: 'Sign in with ChatGPT', subscription: true })
    expect(authMethodsOf('deepseek')).toEqual([{ type: 'api_key', name: expect.any(String), subscription: false }])
    expect(authMethodsOf('nope')).toEqual([])
    expect(listLoginProviders()).toEqual(expect.arrayContaining(['openai', 'deepseek', 'anthropic']))
  })
})

describe('login', () => {
  it('should reject a provider that has no such method', async () => {
    await expect(login('deepseek', 'oauth', typing('x'))).rejects.toThrow()
    await expect(login('nope', 'api_key', typing('x'))).rejects.toThrow()
  })
})

describe('createAuthPlugin', () => {
  it('should store the key typed in, so the model has one without the environment variable', async () => {
    // Arrange
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    const dir = await mkdtemp(join(tmpdir(), 'ji-auth-'))
    const auth = createAuthPlugin({ dir })
    const model = findModel('deepseek/deepseek-flash')
    const before = await model.hasKey()

    // Act
    await auth.login('deepseek', 'api_key', typing('sk-typed'))
    const after = await model.hasKey()
    await auth.logout('deepseek')

    // Assert
    expect(auth.name).toBe('auth')
    expect(auth.file).toBe(join(dir, 'auth.json'))
    expect(before).toBe(false)
    expect(after).toBe(true)
    expect(await model.hasKey()).toBe(false)
    expect(await createFileCredentialStore(auth.file).read('deepseek')).toBeUndefined()
  })
})

// Helpers

async function tempFile(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'ji-auth-')), 'auth.json')
}

/** Answers every prompt with `answer`. */
function typing(answer: string): AuthInteraction {
  return { prompt: async () => answer, notify: () => {} }
}
