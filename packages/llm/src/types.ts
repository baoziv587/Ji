import type { AssistantMessage, AssistantMessageEvent, Message, Static, Tool, ToolCall, ToolResultMessage, TSchema } from '@mariozechner/pi-ai'
import type { Agent, Event, Extension } from '@pi-rsi/kernel'

/** agent 状态：消息历史 + 各插件的状态（以插件名为键） */
export interface AgentState {
  messages: Message[]
  plugins: Readonly<Record<string, unknown>>
}

/**
 * agent 每步执行的动作：
 * - AssistantMessage：模型的一个回合，其中的工具调用由 env 执行
 * - HistoryRewrite：用新的消息列表替换历史（例如上下文压缩）。env 不执行，update 直接替换
 */
export type AgentAction = AssistantMessage | HistoryRewrite

export interface HistoryRewrite {
  type: 'rewrite_history'
  messages: Message[]
}

export type LLMAgent = Agent<AgentState, AgentAction, ToolResultMessage[], AssistantMessage, AssistantMessageEvent>
export type LLMExtension = Extension<AgentState, AgentAction, ToolResultMessage[], AssistantMessage, AssistantMessageEvent>
export type AgentEvent = Event<AgentState, AgentAction, ToolResultMessage[], AssistantMessage, AssistantMessageEvent>

/** pi-ai 的 Tool（TypeBox schema）+ run。run 用方法签名是有意的：参数双变，AgentTool<具体 schema> 才能放进 AgentTool[] */
// eslint-disable-next-line ts/method-signature-style
export type AgentTool<T extends TSchema = TSchema> = Tool<T> & { run(args: Static<T>, signal: AbortSignal): string | Promise<string> }

export interface ToolContext {
  call: ToolCall
  signal: AbortSignal
}

/** 执行一次工具调用。抛出的异常由 agent 转成 isError 结果交还模型（I8） */
export type ToolRunner = (ctx: ToolContext) => Promise<ToolResultMessage>
