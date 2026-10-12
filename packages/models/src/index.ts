// @ji.dev/models: pi-ai's model catalog, the one every agent streams through (RFC-0004)
//
//   models               the collection: every built-in provider, plus what registerProvider adds
//   findModel(spec)      'provider/id' to a model, with the thinking levels it accepts and whether it has a key
//   listProviders()      every provider, with where its key comes from now: what a picker offers
//   registerProvider     a provider of your own: a local server, or a scripted one for tests
//   endpointProvider     an OpenAI-compatible server as a provider; fetchEndpointModels lists what it serves
//   useCredentialStore   where logins are kept
//
// Below @ji.dev/llm, which runs the models, and @ji.dev/testing, which registers fakes: both reach the same catalog.

export {
  type Endpoint,
  ENDPOINT_CONTEXT_WINDOW,
  type EndpointModel,
  endpointProvider,
  fetchEndpointModels,
} from './endpoints.ts'
export {
  findModel,
  listModels,
  type ModelInfo,
  modelInfo,
  type ModelRef,
  nearestThinking,
  UnknownModelError,
  UnsupportedThinkingError,
} from './models.ts'
export { listProviders, type ProviderInfo } from './providers.ts'
export { models, registerProvider, useCredentialStore } from './registry.ts'
