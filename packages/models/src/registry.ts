// The one pi-ai Models collection the agents stream through: every built-in provider, plus what registerProvider adds,
// reading credentials from whatever store useCredentialStore set.

import type { CredentialStore, Provider } from '@earendil-works/pi-ai'
import { InMemoryCredentialStore } from '@earendil-works/pi-ai'
import { builtinModels } from '@earendil-works/pi-ai/providers/all'

/** The store in use. The collection holds the switch below, so the store can change after it is built. */
let credentials: CredentialStore = new InMemoryCredentialStore()

const switchable: CredentialStore = {
  read: (provider, options) => credentials.read(provider, options),
  list: options => credentials.list(options),
  modify: (provider, fn, options) => credentials.modify(provider, fn, options),
  delete: (provider, options) => credentials.delete(provider, options),
}

/**
 * pi-ai's collection itself, for what the functions above do not cover: a login (models.login), a provider's auth
 * methods (models.getProvider(id).auth). Plugins reach pi-ai through it, so an upgrade touches this package alone.
 */
export const models = builtinModels({ credentials: switchable })

/**
 * Adds a provider of your own, a local server or a scripted one for tests say; its models then work like the
 * catalog's. Returns what removes it again. A provider of the same id replaces the earlier one.
 */
export function registerProvider(provider: Provider): () => void {
  models.setProvider(provider)
  return () => models.deleteProvider(provider.id)
}

/**
 * Where credentials are kept: what a login returns, and the key it refreshes. Default: in memory, for the process. An
 * app sets a store that persists before its first call; a stored credential wins over the provider's environment
 * variable, which is read only when nothing is stored.
 */
export function useCredentialStore(store: CredentialStore): void {
  credentials = store
}
