// The providers and their models as a client's picker shows them: every provider of pi-ai's catalog and every endpoint
// the person added, whether it can be used now and where its key comes from, and whether /login signs in to it. And
// what a client changes of them: a key stored or forgotten, an endpoint added, changed or removed.

import type { Endpoint, EndpointModel } from '@ji.dev/llm'
import { fetchEndpointModels, listModels, listProviders, models } from '@ji.dev/llm'
import { authMethodsOf, listEndpoints, login, logout, removeEndpoint, saveEndpoint } from '@ji.dev/plugin-auth'

export interface ProviderView {
  id: string
  name: string
  /** It has a key now: in the environment, stored by /login, or an OAuth login. An endpoint always has. */
  detected: boolean
  /** Where the key comes from: 'DEEPSEEK_API_KEY', 'stored credential', 'OAuth', 'no key'; none when not detected. */
  source?: string
  /** /login <id> signs in to it. */
  login: boolean
  /** A key can be typed in for it: stored with PUT /providers/:id/key. */
  apiKey: boolean
  /** /login <id> can sign in to it in the browser. */
  oauth: boolean
  /** What it has is kept in ~/.ji, a key or a login, so DELETE /providers/:id/key forgets it. */
  stored: boolean
  /** How many chat models it offers. */
  models: number
  /** Present for an endpoint the person added: where it is and the models chosen of it. */
  endpoint?: { baseUrl: string; models: EndpointModel[] }
}

export interface ModelView {
  id: string
  name: string
  /** Tokens. */
  contextWindow: number
  reasoning: boolean
}

/** What a client sends to add an endpoint, or to change one when it names its id. */
export interface EndpointInput {
  id?: string
  name: string
  baseUrl: string
  /** Stored when given; an endpoint changed without one keeps the key it has. */
  key?: string
  models: EndpointModel[]
}

/**
 * Every provider, as the catalog orders them and the endpoints after; checked afresh each time, so a login or a
 * variable set shows at once. `dir` is where the endpoints are kept, ~/.ji.
 */
export async function providerViews(dir?: string): Promise<ProviderView[]> {
  const endpoints = new Map((dir === undefined ? [] : listEndpoints(dir)).map(e => [e.id, e]))
  return (await listProviders()).map(({ id, name, auth, models }) => {
    const methods = authMethodsOf(id)
    const endpoint = endpoints.get(id)
    return {
      id,
      name,
      detected: auth !== undefined,
      source: auth?.source,
      login: methods.length > 0,
      apiKey: methods.some(m => m.type === 'api_key'),
      oauth: methods.some(m => m.type === 'oauth'),
      stored: auth?.type === 'oauth' || auth?.source === 'stored credential',
      models,
      ...(endpoint && { endpoint: { baseUrl: endpoint.baseUrl, models: endpoint.models } }),
    }
  })
}

/** The chat models of a provider; none for an unknown one. */
export function modelViews(provider: string): ModelView[] {
  return listModels(provider).map(({ id, name, contextWindow, reasoning }) => ({ id, name, contextWindow, reasoning }))
}

/** Stores the key as /login would, through the provider's own flow, which asks for nothing but the key. */
export async function storeKey(provider: string, key: string): Promise<void> {
  if (key.trim() === '') {
    throw new Error('the key is empty')
  }
  if (!authMethodsOf(provider).some(m => m.type === 'api_key')) {
    throw new Error(`${provider} takes no key typed in: set it up in the environment, or /login to it`)
  }
  await login(provider, 'api_key', { prompt: async () => key.trim(), notify: () => {} })
}

/** Forgets the stored key or login; the environment variable, if any, is read again. */
export function forgetKey(provider: string): Promise<void> {
  return logout(provider)
}

/** Keeps an endpoint, a new one under an id made of its name, and its key when one is given. */
export async function keepEndpoint(dir: string, input: EndpointInput): Promise<Endpoint> {
  const name = input.name.trim()
  if (name === '') {
    throw new Error('the endpoint needs a name')
  }
  const baseUrl = baseUrlOf(input.baseUrl)
  const ids = [...new Set(input.models.map(m => m.id.trim()).filter(id => id !== ''))]
  if (ids.length === 0) {
    throw new Error('choose at least one model')
  }

  let id = input.id
  if (id === undefined) {
    id = idOf(name)
    if (models.getProvider(id) !== undefined) {
      throw new Error(`"${name}" is taken: there is a provider ${id} already`)
    }
  } else if (!listEndpoints(dir).some(e => e.id === id)) {
    throw new Error(`no endpoint ${id}`)
  }

  const given = new Map(input.models.map(m => [m.id.trim(), m]))
  const endpoint: Endpoint = { id, name, baseUrl, models: ids.map(m => modelOf(m, given.get(m))) }
  await saveEndpoint(dir, endpoint)
  if (input.key !== undefined && input.key.trim() !== '') {
    await storeKey(id, input.key)
  }
  return endpoint
}

export function dropEndpoint(dir: string, id: string): Promise<void> {
  if (!listEndpoints(dir).some(e => e.id === id)) {
    throw new Error(`no endpoint ${id}`)
  }
  return removeEndpoint(dir, id)
}

/** The models the server at baseUrl lists; with no key given, an endpoint's stored one, so changing it asks for none. */
export async function probeEndpoint(baseUrl: string, key?: string, id?: string): Promise<string[]> {
  let bearer = key?.trim() || undefined
  if (bearer === undefined && id !== undefined && models.getProvider(id) !== undefined) {
    bearer = (await models.getAuth(id))?.auth.apiKey
  }
  return fetchEndpointModels(baseUrlOf(baseUrl), bearer)
}

function baseUrlOf(value: string): string {
  let url: URL | undefined
  try {
    url = new URL(value.trim())
  } catch {}
  if (url?.protocol !== 'http:' && url?.protocol !== 'https:') {
    throw new Error(`"${value}" is not an address: it starts with http:// or https://`)
  }
  return url.href.replace(/\/+$/, '')
}

/** 'LM Studio' → 'lm-studio'; a name of no letters or digits → 'endpoint'. */
function idOf(name: string): string {
  return (
    name
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replaceAll(/^-|-$/g, '') || 'endpoint'
  )
}

function modelOf(id: string, given: EndpointModel | undefined): EndpointModel {
  const model: EndpointModel = { id }
  const window = given?.contextWindow
  if (window !== undefined && Number.isFinite(window) && window > 0) {
    model.contextWindow = Math.floor(window)
  }
  if (given?.reasoning === true) {
    model.reasoning = true
  }
  return model
}
