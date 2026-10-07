// Logging in to a provider: in the browser, for one that offers OAuth (openai with a ChatGPT subscription, say), or by
// typing the key in. What the flow returns goes to the credential store, and the models read it from there.

import type { AuthInteraction, AuthType, Credential } from '@ji.dev/llm'
import { models } from '@ji.dev/llm'

/** One way to log in to a provider, as pi-ai describes it. */
export interface AuthMethod {
  type: AuthType
  /** For a menu: "Sign in with ChatGPT", "OpenAI API key". */
  name: string
  /** Access comes with a subscription, not a bill per token. */
  subscription: boolean
}

export interface LoginOptions {
  /** A UUID that stays the same across the logins of one installation; OpenAI requires it. */
  getDeviceId?: () => string
}

/** The ways to log in to a provider, OAuth first. Empty for an unknown provider, or one whose key cannot be typed in. */
export function authMethodsOf(provider: string): AuthMethod[] {
  const auth = models.getProvider(provider)?.auth
  if (auth === undefined) {
    return []
  }

  const methods: AuthMethod[] = []
  if (auth.oauth !== undefined) {
    methods.push({
      type: 'oauth',
      name: auth.oauth.loginLabel ?? auth.oauth.name,
      subscription: auth.oauth.isSubscription === true,
    })
  }
  if (auth.apiKey?.login !== undefined) {
    methods.push({ type: 'api_key', name: auth.apiKey.name, subscription: false })
  }
  return methods
}

/** The providers that have a way to log in. */
export function listLoginProviders(): string[] {
  return models
    .getProviders()
    .map(p => p.id)
    .filter(id => authMethodsOf(id).length > 0)
}

/**
 * Runs the provider's login flow, asking and telling through `interaction`, and stores what it returns. Rejects when
 * the provider or the method is unknown, when the person cancels, and when the provider refuses.
 */
export function login(
  provider: string,
  type: AuthType,
  interaction: AuthInteraction,
  options: LoginOptions = {},
): Promise<Credential> {
  return models.login(provider, type, interaction, options)
}

/** Forgets what login stored; the provider's environment variable, if any, is read again. */
export function logout(provider: string): Promise<void> {
  return models.logout(provider)
}
