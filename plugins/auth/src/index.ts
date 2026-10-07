// @ji.dev/plugin-auth: credentials kept in a directory of the person's, and logging in to a provider from there.
//
//   const auth = createAuthPlugin({ dir: join(homedir(), '.ji') })
//   await auth.login('openai', 'oauth', interaction)     Sign in with ChatGPT, in the browser; the token is stored
//   await auth.login('deepseek', 'api_key', interaction)   the key typed in, stored instead of the environment variable
//   await auth.logout('openai')
//
//   The directory holds auth.json, one credential per provider, and installation-id, the UUID OpenAI identifies this
//   installation by, made on the first login and kept. Creating the plugin makes the file the credential store of
//   every model (useCredentialStore): the plugin has no hook of its own, it is in the list so that the one place
//   that adds tool sets adds this too.
//
//   store    createFileCredentialStore(file): the store on its own, for a process that only reads the credentials
//   login    authMethodsOf(provider), login and logout: pi-ai's flows, on whatever store is in use

import type { AuthInteraction, AuthType, Credential, Plugin } from '@ji.dev/llm'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { definePlugin, useCredentialStore } from '@ji.dev/llm'
import { login, logout } from './login.ts'
import { createFileCredentialStore } from './store.ts'

export { type AuthMethod, authMethodsOf, listLoginProviders, login, type LoginOptions, logout } from './login.ts'
export { createFileCredentialStore } from './store.ts'

export interface AuthPlugin extends Plugin {
  /** Where the credentials are, for a message that says so. */
  readonly file: string
  login: (provider: string, type: AuthType, interaction: AuthInteraction) => Promise<Credential>
  logout: (provider: string) => Promise<void>
}

export interface AuthOptions {
  /** Made if missing, readable by its owner only. */
  dir: string
}

export function createAuthPlugin({ dir }: AuthOptions): AuthPlugin {
  const file = join(dir, 'auth.json')
  useCredentialStore(createFileCredentialStore(file))

  return {
    ...definePlugin({ name: 'auth' }),
    file,
    login: (provider, type, interaction) =>
      login(provider, type, interaction, { getDeviceId: () => installationIdOf(dir) }),
    logout,
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The UUID in `dir`/installation-id; made and written on the first call. Synchronous: pi-ai asks for it as such. */
export function installationIdOf(dir: string): string {
  const file = join(dir, 'installation-id')
  const found = readIfThere(file)?.trim()
  if (found !== undefined && UUID.test(found)) {
    return found
  }

  const made = randomUUID()
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  writeFileSync(file, `${made}\n`, { mode: 0o600 })
  return made
}

function readIfThere(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
}
