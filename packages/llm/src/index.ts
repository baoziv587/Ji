// @ji.dev/llm: the kernel instantiated with pi-ai (RFC-0004)
//
//   Users only touch four objects:
//     Agent    createAgent({ model, tools, plugins })   model + tools + plugins, stateless; agent.with(...) for variants
//     Session  createSession(agent)                     one conversation: send(message, { when }), use(agent)
//     Run      returned by session.send(...)            one stream of events, per-step records, stats, final result
//     Plugin   definePlugin({ ... })                    changes behavior at fixed points of a step, or observes

export { type Agent, type AgentOptions, createAgent } from './agent.ts'
export { RunError, type RunErrorKind } from './errors.ts'
export { callsOf, textOf, user } from './message.ts'
export { after, before, type Cancellable, intercept, mapEvents, type Middleware } from './middleware.ts'
export { findModel, listModels, type ModelInfo, UnknownModelError, UnsupportedThinkingError } from './models.ts'
export {
  type AnyPlugin,
  type CallOptions,
  type CompleteRequest,
  type DecideContext,
  type DecideNext,
  type DecideStream,
  definePlugin,
  type HookContext,
  type InputContext,
  type Plugin,
  PluginConflictError,
  type PluginList,
  type PluginSpec,
  type PluginState,
  type RecordInput,
  type RequestContext,
  type ToolCallsRunner,
} from './plugin.ts'
export { models, registerProvider, useCredentialStore } from './registry.ts'
export type { Run } from './run.ts'
export { createSession, type Session, type SessionOptions } from './session.ts'
export { usageOf } from './summary.ts'
export { tool, toolError, toolResult } from './tool.ts'
export { rewriteHistory, stop } from './turn.ts'
export type {
  AgentAction,
  AgentState,
  AgentTool,
  Boundary,
  Events,
  InputAction,
  ModelCall,
  ModelRef,
  ModelRequest,
  Payload,
  PendingMessage,
  RewriteAction,
  RunEvent,
  RunInfo,
  RunSummary,
  StreamOptions,
  ThinkingLevel,
  ToolOutput,
  ToolRunner,
  Turn,
  TurnEvent,
  TurnTiming,
  UsageTotals,
  When,
} from './types.ts'
// What writing an agent needs from pi-ai, so tools, events and models come from one import
export { Type } from '@earendil-works/pi-ai'

export type {
  Api,
  AssistantMessage,
  AuthEvent,
  AuthInteraction,
  AuthPrompt,
  AuthType,
  Credential,
  CredentialInfo,
  CredentialStore,
  JsonObject,
  JsonValue,
  Message,
  Model,
  Provider,
  ToolCall,
  ToolResultMessage,
  TSchema,
  Usage,
} from '@earendil-works/pi-ai'
export type { Stream } from '@ji.dev/kernel'
