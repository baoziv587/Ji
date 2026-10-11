// Logging in from the terminal: /login <provider> asks how, when there is a choice, and runs the flow; /logout
// <provider> forgets what it stored. The credentials live in ~/.ji, where headless reads them too.

import type { AuthEvent, AuthInteraction } from '@ji.dev/llm'
import type { AuthMethod, AuthPlugin } from '@ji.dev/plugin-auth'
import type { Command, Say } from '../agent/commands.ts'
import type { Feature } from './feature.ts'
import { spawn } from 'node:child_process'
import process from 'node:process'
import { log } from '@clack/prompts'
import { authMethodsOf, createAuthPlugin, listLoginProviders } from '@ji.dev/plugin-auth'
import { abbreviateHomePath } from '@ji.dev/tui'
import { errorMessage } from '@ji.dev/utils'

export interface AuthFeature extends Feature {
  plugin: AuthPlugin
  /** What /login does, settled once the flow is over; its outcome is logged, never thrown. */
  login: (provider: string) => Promise<void>
}

/** What it has to say goes to `say`: the terminal's log, unless told otherwise. */
export function createAuthFeature(dir: string, interaction: AuthInteraction, say: Say = log): AuthFeature {
  const plugin = createAuthPlugin({ dir })

  const login = async (provider: string): Promise<void> => {
    const methods = authMethodsOf(provider)
    if (methods.length === 0) {
      say.error(`Nothing to log in to for "${provider}". Providers: ${listLoginProviders().join(', ')}`)
      return
    }

    try {
      const method = methods.length === 1 ? methods[0] : await choose(provider, methods, interaction)
      await plugin.login(provider, method.type, interaction)
      say.success(`Logged in to ${provider} with ${method.name}; kept in ${abbreviateHomePath(plugin.file)}`)
    } catch (error) {
      say.error(errorMessage(error))
    }
  }

  const logout = async (provider: string): Promise<void> => {
    try {
      await plugin.logout(provider)
      say.success(`Logged out of ${provider}`)
    } catch (error) {
      say.error(errorMessage(error))
    }
  }

  const commands: Command[] = [
    {
      name: '/login',
      arg: '<provider>',
      hint: 'signs in: in the browser, or with a key typed in',
      choices: listLoginProviders,
      run: provider => void login(provider.trim()),
    },
    {
      name: '/logout',
      arg: '<provider>',
      hint: 'forgets what /login kept',
      choices: listLoginProviders,
      run: provider => void logout(provider.trim()),
    },
  ]

  return { plugin, commands, login }
}

/** What a login's flow tells, as a line or two to read: the terminal's log, or a client's notice. */
export function describeAuthEvent(e: AuthEvent): string {
  switch (e.type) {
    case 'auth_url':
      return e.instructions === undefined ? `Open ${e.url}` : `Open ${e.url}\n${e.instructions}`
    case 'device_code':
      return `Go to ${e.verificationUri} and enter ${e.userCode}`
    case 'info':
      return [e.message, ...(e.links ?? []).map(l => l.url)].join('\n')
    default:
      return e.message
  }
}

/** Best effort, on the machine the agent runs on: the URL is told either way. */
export function openBrowser(url: string): void {
  const [command, args] = browserCommand(url)

  const child = spawn(command, args, { stdio: 'ignore', detached: true })
  child.on('error', () => {})
  child.unref()
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

function browserCommand(url: string): [string, string[]] {
  switch (process.platform) {
    case 'darwin':
      return ['open', [url]]
    case 'win32':
      return ['cmd', ['/c', 'start', '', url]]
    default:
      return ['xdg-open', [url]]
  }
}
