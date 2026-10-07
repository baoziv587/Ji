// Logging in from the terminal: /login <provider> asks how, when there is a choice, and runs the flow; /logout
// <provider> forgets what it stored. The credentials live in ~/.ji, where headless reads them too.

import type { AuthInteraction } from '@ji.dev/llm'
import type { AuthMethod, AuthPlugin } from '@ji.dev/plugin-auth'
import type { Command } from '../ui/menu.ts'
import type { Feature } from './feature.ts'
import { log } from '@clack/prompts'
import { authMethodsOf, createAuthPlugin, listLoginProviders } from '@ji.dev/plugin-auth'
import { abbreviateHomePath } from '@ji.dev/tui'

export interface AuthFeature extends Feature {
  plugin: AuthPlugin
  /** What /login does, settled once the flow is over; its outcome is logged, never thrown. */
  login: (provider: string) => Promise<void>
}

export function createAuthFeature(dir: string, interaction: AuthInteraction): AuthFeature {
  const plugin = createAuthPlugin({ dir })

  const login = async (provider: string): Promise<void> => {
    const methods = authMethodsOf(provider)
    if (methods.length === 0) {
      log.error(`Nothing to log in to for "${provider}". Providers: ${listLoginProviders().join(', ')}`)
      return
    }

    try {
      const method = methods.length === 1 ? methods[0] : await choose(provider, methods, interaction)
      await plugin.login(provider, method.type, interaction)
      log.success(`Logged in to ${provider} with ${method.name}; kept in ${abbreviateHomePath(plugin.file)}`)
    } catch (error) {
      log.error(error instanceof Error ? error.message : String(error))
    }
  }

  const logout = async (provider: string): Promise<void> => {
    try {
      await plugin.logout(provider)
      log.success(`Logged out of ${provider}`)
    } catch (error) {
      log.error(error instanceof Error ? error.message : String(error))
    }
  }

  const commands: Command[] = [
    {
      name: '/login',
      arg: '<provider>',
      hint: 'signs in: in the browser, or with a key typed in',
      run: provider => void login(provider.trim()),
    },
    {
      name: '/logout',
      arg: '<provider>',
      hint: 'forgets what /login kept',
      run: provider => void logout(provider.trim()),
    },
  ]

  return { plugin, commands, login }
}

async function choose(provider: string, methods: AuthMethod[], interaction: AuthInteraction): Promise<AuthMethod> {
  const chosen = await interaction.prompt({
    type: 'select',
    message: `How to log in to ${provider}?`,
    options: methods.map(m => ({
      id: m.type,
      label: m.name,
      description: m.subscription ? 'with your subscription' : undefined,
    })),
  })
  return methods.find(m => m.type === chosen) ?? methods[0]
}
