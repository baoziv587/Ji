import type { AuthCheck } from '@earendil-works/pi-ai'
import { models } from './registry.ts'

/** A provider of the catalog, and whether it can be used now: what a list of providers shows. */
export interface ProviderInfo {
  id: string
  name: string
  /**
   * Where its key comes from now: an environment variable ('DEEPSEEK_API_KEY'), a stored key, an OAuth login.
   * Undefined when it has none, so a model of it fails until the person logs in or sets the variable.
   */
  auth: AuthCheck | undefined
  /** How many chat models it offers. */
  models: number
}

/** Every provider of the catalog and the registered ones, each with how it is configured now, checked all at once. */
export function listProviders(): Promise<ProviderInfo[]> {
  return Promise.all(
    models.getProviders().map(async ({ id, name }) => ({
      id,
      name,
      auth: await models.checkAuth(id),
      models: models.getModels(id).length,
    })),
  )
}
