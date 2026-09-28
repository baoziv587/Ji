import type { Api, KnownProvider, Model } from '@mariozechner/pi-ai'
import type { ModelRef, ThinkingLevel } from './types.ts'
import { closest } from '@ji.dev/utils'
import { getEnvApiKey, getModels, getProviders, getSupportedThinkingLevels } from '@mariozechner/pi-ai'

/** A pi-ai Model plus what the agent already knows about it; still a Model, so pi-ai functions accept it. */
export type ModelInfo = Model<Api> & {
  /**
   * Levels this model accepts, lightest first. A model that cannot think has only ['off']; one that always thinks has
   * no 'off' at all.
   */
  readonly thinkingLevels: readonly ThinkingLevel[]
  /**
   * Whether the provider's API key is set in the environment right now. Nothing checks it for you: a key can also
   * come from `apiKey` or a request plugin, so ask for one when the user is about to send, not up front.
   */
  readonly hasEnvKey: boolean
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

export function modelInfo(model: Model<Api>): ModelInfo {
  return {
    ...model,
    thinkingLevels: getSupportedThinkingLevels(model),
    get hasEnvKey() {
      return getEnvApiKey(model.provider) !== undefined
    },
  }
}

/** Models from pi-ai's catalog, of one provider or of all. */
export function listModels(provider?: string): ModelInfo[] {
  const providers = provider === undefined ? getProviders() : [provider as KnownProvider]
  return providers.flatMap(p => getModels(p).map(m => modelInfo(m as Model<Api>)))
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
  const providers = getProviders() as string[]
  if (!providers.includes(provider)) {
    const match = closest(provider, providers)
    throw new UnknownModelError(spec, {
      reason: `Unknown provider "${provider}"`,
      suggestion: match === undefined ? undefined : `${match}/${id}`,
      available: providers,
    })
  }

  const models = listModels(provider)
  const found = models.find(m => m.id === id)
  if (found === undefined) {
    const specs = models.map(specOf)
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
