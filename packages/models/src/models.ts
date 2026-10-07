import type { Api, Model, ModelThinkingLevel as ThinkingLevel } from '@earendil-works/pi-ai'
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai'
import { closest } from '@ji.dev/utils'
import { models } from './registry.ts'

/** A pi-ai Model plus what the agent already knows about it; still a Model, so pi-ai functions accept it. */
export type ModelInfo = Model<Api> & {
  /**
   * Levels this model accepts, lightest first. A model that cannot think has only ['off']; one that always thinks has
   * no 'off' at all.
   */
  readonly thinkingLevels: readonly ThinkingLevel[]
  /**
   * Whether the provider has a key right now, in the environment or stored. Nothing checks it for you: a key can also
   * come from `apiKey` or a request plugin, so ask for one when the user is about to send, not up front.
   */
  readonly hasKey: () => Promise<boolean>
}

/** Thrown by findModel and createAgent; `available` and `suggestion` are ready for a model picker. */
export class UnknownModelError extends Error {
  readonly spec: string
  readonly suggestion: string | undefined
  readonly available: string[]

  constructor(spec: string, detail: { reason: string; suggestion?: string; available: string[] }) {
    const hint = detail.suggestion === undefined ? '' : ` Did you mean "${detail.suggestion}"?`
    super(`${detail.reason}.${hint}\nAvailable: ${detail.available.join(', ')}`)
    this.name = 'UnknownModelError'
    this.spec = spec
    this.suggestion = detail.suggestion
    this.available = detail.available
  }
}

/** Which model a request went to. */
export interface ModelRef {
  provider: string
  id: string
}

/** Thrown by createAgent and agent.with when the model does not accept the thinking level. */
export class UnsupportedThinkingError extends Error {
  readonly model: ModelRef
  readonly level: string
  readonly supported: readonly ThinkingLevel[]

  constructor(model: ModelInfo, level: string) {
    super(
      `${model.provider}/${model.id} does not support thinking "${level}". Supported: ${model.thinkingLevels.join(', ')}`,
    )
    this.name = 'UnsupportedThinkingError'
    this.model = { provider: model.provider, id: model.id }
    this.level = level
    this.supported = model.thinkingLevels
  }
}

/** Any pi-ai Model, a custom endpoint's or a fake's, with its thinking levels and a key check. */
export function modelInfo(model: Model<Api>): ModelInfo {
  return {
    ...model,
    thinkingLevels: getSupportedThinkingLevels(model),
    hasKey: async () => (await models.checkAuth(model.provider)) !== undefined,
  }
}

/** Models from pi-ai's catalog and the registered providers, of one provider or of all. */
export function listModels(provider?: string): ModelInfo[] {
  return models.getModels(provider).map(modelInfo)
}

/**
 * Looks a model up in pi-ai's catalog. `spec` is 'provider/id', or a bare id when exactly one provider offers it.
 * Throws UnknownModelError with the closest match and the alternatives.
 */
export function findModel(spec: string): ModelInfo {
  const slash = spec.indexOf('/')
  return slash === -1 ? findById(spec) : findInProvider(spec, spec.slice(0, slash), spec.slice(slash + 1))
}

function findInProvider(spec: string, provider: string, id: string): ModelInfo {
  const providers = models.getProviders().map(p => p.id)
  if (!providers.includes(provider)) {
    const match = closest(provider, providers)
    throw new UnknownModelError(spec, {
      reason: `Unknown provider "${provider}"`,
      suggestion: match === undefined ? undefined : `${match}/${id}`,
      available: providers,
    })
  }

  const offered = listModels(provider)
  const found = offered.find(m => m.id === id)
  if (found === undefined) {
    const specs = offered.map(specOf)
    throw new UnknownModelError(spec, {
      reason: `Unknown model "${spec}"`,
      suggestion: closest(spec, specs),
      available: specs,
    })
  }
  return found
}

function findById(id: string): ModelInfo {
  const all = listModels()
  const matches = all.filter(m => m.id === id)
  if (matches.length === 1) {
    return matches[0]
  }

  const specs = matches.length > 1 ? matches.map(specOf) : all.map(specOf)
  throw new UnknownModelError(id, {
    reason:
      matches.length > 1
        ? `Model "${id}" is offered by several providers; write it as provider/id`
        : `Unknown model "${id}"`,
    suggestion: matches.length > 1 ? undefined : closest(id, specs, s => s.slice(s.indexOf('/') + 1)),
    available: specs,
  })
}

function specOf(m: Model<Api>): string {
  return `${m.provider}/${m.id}`
}
