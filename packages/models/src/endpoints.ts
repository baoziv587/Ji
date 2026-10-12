// A server of your own that speaks OpenAI's chat completions, Ollama, LM Studio or a company proxy, as a provider of the
// catalog: its models are the ids the person listed, its key the one they stored, if it needs one at all.

import type { Api, ApiKeyAuth, Model, Provider } from '@earendil-works/pi-ai'
import { createProvider, envApiKeyAuth } from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'

export interface Endpoint {
  id: string
  name: string
  /** Up to the version, as OpenAI's SDK takes it: 'http://localhost:11434/v1'. */
  baseUrl: string
  models: EndpointModel[]
}

export interface EndpointModel {
  id: string
  /** Tokens; default ENDPOINT_CONTEXT_WINDOW. */
  contextWindow?: number
  reasoning?: boolean
}

/**
 * What a model of an endpoint is taken to hold when the person does not say: its 80% is above the 200k a session
 * compacts at, so an endpoint's sessions compact where the catalog's large models do.
 */
export const ENDPOINT_CONTEXT_WINDOW = 256_000

/** What a reply may run to; less when the window is smaller. */
const MAX_TOKENS = 16_384

/** A local server takes any key, and OpenAI's SDK refuses to send none. */
const NO_KEY = 'none'

export function endpointProvider(endpoint: Endpoint): Provider {
  return createProvider({
    id: endpoint.id,
    name: endpoint.name,
    baseUrl: endpoint.baseUrl,
    auth: { apiKey: keyOrNone(endpoint.name) },
    models: endpoint.models.map(m => endpointModel(endpoint, m)),
    api: openAICompletionsApi(),
  })
}

/** The stored key when there is one; otherwise the endpoint still counts as set up, for a server that wants none. */
function keyOrNone(name: string): ApiKeyAuth {
  return {
    ...envApiKeyAuth(`${name} key`, []),
    resolve: async ({ credential }) => {
      if (credential?.key) {
        return { auth: { apiKey: credential.key }, source: 'stored credential' }
      }
      return { auth: { apiKey: NO_KEY }, source: 'no key' }
    },
  }
}

function endpointModel(endpoint: Endpoint, model: EndpointModel): Model<Api> {
  const contextWindow = model.contextWindow ?? ENDPOINT_CONTEXT_WINDOW
  return {
    id: model.id,
    name: model.id,
    api: 'openai-completions',
    provider: endpoint.id,
    baseUrl: endpoint.baseUrl,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: model.reasoning ?? false,
    contextWindow,
    maxTokens: Math.min(MAX_TOKENS, Math.floor(contextWindow / 4)),
  }
}

/**
 * The model ids the server lists at `baseUrl`/models, sorted. Rejects with what went wrong, worded for the person
 * who typed the address: it cannot be reached, it refuses the key, or it lists none.
 */
export async function fetchEndpointModels(baseUrl: string, key?: string, signal?: AbortSignal): Promise<string[]> {
  const url = `${baseUrl.replace(/\/+$/, '')}/models`
  let res: Response
  try {
    res = await fetch(url, {
      headers: key ? { authorization: `Bearer ${key}` } : {},
      signal: signal ?? AbortSignal.timeout(10_000),
    })
  } catch (error) {
    throw new Error(`Could not reach ${url}: ${causeOf(error)}`)
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error(`${url} refused the key (${res.status})`)
  }
  if (!res.ok) {
    throw new Error(`${url} answered ${res.status} ${res.statusText}`.trim())
  }

  const body: unknown = await res.json().catch(() => undefined)
  const ids = idsOf(body)
  if (ids === undefined) {
    throw new Error(`${url} did not answer with a list of models`)
  }
  if (ids.length === 0) {
    throw new Error(`${url} lists no models`)
  }
  return ids.toSorted()
}

/** OpenAI's {data: [{id}]}; undefined for anything else. */
function idsOf(body: unknown): string[] | undefined {
  const data = (body as { data?: unknown } | undefined)?.data
  if (!Array.isArray(data)) {
    return undefined
  }
  return data.flatMap(m => (typeof m?.id === 'string' && m.id !== '' ? [m.id as string] : []))
}

/** What fetch's "fetch failed" hides: ECONNREFUSED, a bad host, the timeout. */
function causeOf(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return 'no answer in 10 seconds'
  }
  const cause = (error as { cause?: { code?: string; message?: string } }).cause
  return cause?.code ?? cause?.message ?? (error instanceof Error ? error.message : String(error))
}
