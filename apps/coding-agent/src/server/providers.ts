// The providers and their models as a client's picker shows them: every provider of pi-ai's catalog, whether it can be
// used now and where its key comes from, and whether /login signs in to it.

import { listModels, listProviders } from '@ji.dev/llm'
import { authMethodsOf } from '@ji.dev/plugin-auth'

export interface ProviderView {
  id: string
  name: string
  /** It has a key now: in the environment, stored by /login, or an OAuth login. */
  detected: boolean
  /** Where the key comes from: 'DEEPSEEK_API_KEY', 'stored credential', 'OAuth'; none when not detected. */
  source?: string
  /** /login <id> signs in to it. */
  login: boolean
  /** How many chat models it offers. */
  models: number
}

export interface ModelView {
  id: string
  name: string
  /** Tokens. */
  contextWindow: number
  reasoning: boolean
}

/** Every provider, as the catalog orders them; checked afresh each time, so a login or a variable set shows at once. */
export async function providerViews(): Promise<ProviderView[]> {
  return (await listProviders()).map(({ id, name, auth, models }) => ({
    id,
    name,
    detected: auth !== undefined,
    source: auth?.source,
    login: authMethodsOf(id).length > 0,
    models,
  }))
}

/** The chat models of a provider; none for an unknown one. */
export function modelViews(provider: string): ModelView[] {
  return listModels(provider).map(({ id, name, contextWindow, reasoning }) => ({ id, name, contextWindow, reasoning }))
}
