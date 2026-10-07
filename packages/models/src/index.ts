// @ji.dev/models: pi-ai's model catalog, the one every agent streams through (RFC-0004)
//
//   models               the collection: every built-in provider, plus what registerProvider adds
//   findModel(spec)      'provider/id' to a model, with the thinking levels it accepts and whether it has a key
//   registerProvider     a provider of your own: a local server, or a scripted one for tests
//   useCredentialStore   where logins are kept
//
// Below @ji.dev/llm, which runs the models, and @ji.dev/testing, which registers fakes: both reach the same catalog.

export {
  findModel,
  listModels,
  type ModelInfo,
  modelInfo,
  type ModelRef,
  UnknownModelError,
  UnsupportedThinkingError,
} from './models.ts'
export { models, registerProvider, useCredentialStore } from './registry.ts'
