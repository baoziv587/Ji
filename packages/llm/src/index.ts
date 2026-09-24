// @pi-rsi/llm —— 用 pi-ai 实例化内核：厂商适配、消息格式、流式折叠全部交给 pi-ai
//
//   S = AgentState             消息历史 + 各插件的状态
//   A = AssistantMessage       带 toolCall 的助手回合
//   O = ToolResultMessage[]
//   R = AssistantMessage       最终回答（含 usage / cost / stopReason）
//   D = AssistantMessageEvent  text_delta / toolcall_delta / thinking_delta …
//
//   扩展方式见 RFC-0003：definePlugin + createAgent

export { type AgentInput, type AgentOptions, createAgent, initialState, run, stream } from './agent.ts'
export { isHistoryRewrite, rewriteHistory } from './history.ts'
export { callsOf, textOf, user } from './message.ts'
export { definePlugin, type Plugin, PluginConflictError, type PluginList, type PluginSpec, type PluginState } from './plugin.ts'
export { tool, toolError, toolResult } from './tool.ts'
export type { AgentAction, AgentEvent, AgentState, AgentTool, HistoryRewrite, LLMAgent, LLMExtension, ToolContext, ToolRunner } from './types.ts'
