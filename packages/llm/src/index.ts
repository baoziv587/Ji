// @gaoxiang.ai/llm: the kernel instantiated with pi-ai (RFC-0004)
//
//   Users only touch four objects:
//     Agent    createAgent({ model, tools, plugins })   model + tools + plugins, stateless; agent.with(...) for variants
//     Session  createSession(agent)                     one conversation: send(message, { when }), use(agent)
//     Run      returned by session.send(...)            one stream of events, per-step records, stats, final result
//     Plugin   definePlugin({ ... })                    changes behavior at fixed points of a step, or observes

export { type Agent, type AgentOptions, createAgent } from './agent.ts'
export { RunError, type RunErrorKind } from './errors.ts'
export { callsOf, textOf, user } from './message.ts'
export { after, before, mapDeltas, type Middleware } from './middleware.ts'
export { findModel, listModels, type ModelInfo, UnknownModelError, UnsupportedThinkingError } from './models.ts'
export {
  definePlugin,
  type EnvCall,
  type Plugin,
  PluginConflictError,
  type PluginList,
  type PluginSpec,
  type PluginState,
  type TurnStream,
} from './plugin.ts'
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
  ToolContext,
  ToolRunner,
  Turn,
  TurnEvent,
  TurnTiming,
  UsageTotals,
  When,
} from './types.ts'
export type { Stream } from '@gaoxiang.ai/kernel'

// What writing an agent needs from pi-ai, so tools, events and models come from one import
export { Type } from '@mariozechner/pi-ai'
export type { Api, AssistantMessage, Message, Model, ToolCall, ToolResultMessage, TSchema } from '@mariozechner/pi-ai'
