// Fast mode: OpenAI answers on its priority tier, about 1.5x faster, for more of the subscription's usage or a higher
// bill. pi-ai's streamSimple leaves its serviceTier option out, so the tier goes into the request body instead.

import type { Api, Model } from '@ji.dev/llm'

/** Where the tier is taken: the OpenAI API, ChatGPT sign-in included, and ChatGPT's Codex backend. */
const FAST_PROVIDERS = new Set(['openai', 'openai-codex'])

/** The server still answers some models at the standard speed: gpt-5.5, for one, on ChatGPT sign-in. */
export function supportsFastMode(model: Pick<Model<Api>, 'provider'>): boolean {
  return FAST_PROVIDERS.has(model.provider)
}

/**
 * pi-ai's onPayload: asks for the priority tier on a model that takes it, and leaves any other request as it is.
 * "priority", not "fast", its newer name: ChatGPT sign-in refuses "fast".
 */
export function requestFastTier(payload: unknown, model: Model<Api>): unknown {
  if (!supportsFastMode(model) || typeof payload !== 'object' || payload === null) {
    return undefined
  }
  return { ...payload, service_tier: 'priority' }
}
