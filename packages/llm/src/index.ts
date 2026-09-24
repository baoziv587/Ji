// @pi-rsi/llm：用 pi-ai 实例化内核（RFC-0004）
//
//   使用者只接触四个对象：
//     Agent    createAgent({ model, tools, plugins })   模型、工具、插件的组合，不含状态
//     Session  createSession(agent)                     一段对话；唯一的方法 send(message, { when })
//     Run      session.send(...) 的返回值               文字流、每步记录、统计、最终结果
//     Plugin   definePlugin({ ... })                    在一步的固定位置改变行为

export { type Agent, type AgentOptions, createAgent } from './agent.ts'
export { callsOf, textOf, user } from './message.ts'
export { after, before, type Middleware } from './middleware.ts'
export { definePlugin, type Plugin, PluginConflictError, type PluginList, type PluginSpec, type PluginState } from './plugin.ts'
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
