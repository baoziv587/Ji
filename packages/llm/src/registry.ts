// The one pi-ai Models collection the agents stream through: every built-in provider, plus what registerProvider adds.

import type { Provider } from '@earendil-works/pi-ai'
import { builtinModels } from '@earendil-works/pi-ai/providers/all'

export const models = builtinModels()

/**
 * Adds a provider of your own, a local server or a scripted one for tests say; its models then work like the
 * catalog's. Returns what removes it again. A provider of the same id replaces the earlier one.
 */
export function registerProvider(provider: Provider): () => void {
  models.setProvider(provider)
  return () => models.deleteProvider(provider.id)
}
