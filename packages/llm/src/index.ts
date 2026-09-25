// @gaoxiang.ai/llm: the kernel instantiated with pi-ai (RFC-0004)
//
//   Users only touch four objects:
//     Agent    createAgent({ model, tools, plugins })   model + tools + plugins, stateless
//     Session  createSession(agent)                     one conversation; its only method is send(message, { when })
//     Run      returned by session.send(...)            text stream, per-step records, stats, final result
//     Plugin   definePlugin({ ... })                    changes behavior at fixed points of a step

export { type Agent, type AgentOptions, createAgent } from './agent.ts'
export { callsOf, textOf, user } from './message.ts'
export { after, before, type Middleware } from './middleware.ts'
export {
  definePlugin,
  type Plugin,
  PluginConflictError,
  type PluginList,
  type PluginSpec,
  type PluginState,
  type PolicyStream,
} from './plugin.ts'
export type { Run } from './run.ts'
export { createSession, type Session, type SessionOptions } from './session.ts'
export { usageOf } from './summary.ts'
export { tool, toolError, toolResult } from './tool.ts'
export { rewriteHistory, stop } from './turn.ts'
export type {
  AgentAction,
  AgentEvent,
  AgentState,
  AgentTool,
  Boundary,
  InputAction,
  ModelCall,
  ModelRequest,
  PendingMessage,
  RewriteAction,
  RunSummary,
  ToolContext,
  ToolRunner,
  Turn,
  TurnEvent,
  TurnTiming,
  UsageTotals,
  When,
} from './types.ts'
