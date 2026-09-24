import type { Event, Agent as KernelAgent, Stream } from '@ji/kernel'
import type { Api, AssistantMessage, AssistantMessageEvent, Message, Model, SimpleStreamOptions, Static, Tool, ToolCall, ToolResultMessage, TSchema } from '@mariozechner/pi-ai'

/** agent 状态：消息历史 + 各插件的状态（以插件名为键） */
export interface AgentState {
  messages: Message[]
  plugins: Readonly<Record<string, unknown>>
}

/**
 * 每一步一条记录。update、插件的 state.reduce、Run.turns 看到的是同一个序列（I13）。
 * - model：模型回合及其工具结果；最终回答的 results 为 []
 * - input：在步边界插入的外部消息
 * - rewrite：rewriteHistory 替换了整个历史
 */
export type Turn
  = | { kind: 'model', message: AssistantMessage, results: ToolResultMessage[] }
    | InputAction
    | RewriteAction

export interface InputAction {
  kind: 'input'
  messages: Message[]
  /** 插入时 agent 是否空闲 */
  idle: boolean
  /** 这个步边界是否由中断产生 */
  interrupted: boolean
}

export interface RewriteAction {
  kind: 'rewrite'
  messages: Message[]
}

/** 内核的动作：模型回合，或者不需要执行工具的历史编辑 */
export type AgentAction = AssistantMessage | InputAction | RewriteAction

/** 步边界：两步之间，模型没有在输出，工具也没有在执行 */
export interface Boundary {
  state: AgentState
  /** agent 空闲：历史为空，或最后一条是没有工具调用的助手消息 */
  idle: boolean
}

/** 一次模型调用的全部输入。request 钩子可以改其中任何字段 */
export interface ModelRequest {
  model: Model<Api>
  systemPrompt: string
  /** context 钩子的结果 */
  messages: Message[]
  /** 这一次请求可用的工具 */
  tools: Tool[]
  options: SimpleStreamOptions
  /** 只读 */
  state: AgentState
}

export type ModelCall = (req: ModelRequest) => Stream<AssistantMessageEvent, AssistantMessage>

/** 内核层的 LLM agent。每次运行由 createAgent 的结果实例化一次 */
export type LLMAgent = KernelAgent<AgentState, AgentAction, ToolResultMessage[], AssistantMessage, AssistantMessageEvent>
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

/** 累计用量。cost 为美元，来自 provider 的计价 */
export interface UsageTotals {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cost: number
}

export interface TurnTiming {
  /** 这一步总耗时 */
  ms: number
  /** 模型回合：从这一步开始到模型输出结束 */
  modelMs?: number
  /** 模型回合：到第一段内容（文字、思考或工具参数） */
  firstTokenMs?: number
  /** 模型回合：每个工具调用的耗时，以 toolCall.id 为键 */
  toolMs?: Record<string, number>
}

export interface RunSummary {
  /** 模型回合数 */
  turns: number
  usage: UsageTotals
  modelMs: number
  /** 各次工具调用耗时之和；并行调用会重叠，所以可能大于实际经过的时间 */
  toolMs: number
  /** 以工具名为键 */
  tools: Record<string, { calls: number, errors: number, ms: number }>
  /** 插入的外部消息数 */
  inputs: number
  /** 历史被替换的次数 */
  rewrites: number
}

export interface TurnEvent {
  t: number
  turn: Turn
  /** 这一步之后的状态 */
  state: AgentState
  timing: TurnTiming
  /** 这次运行到这一步为止的统计 */
  summary: RunSummary
}

/** 外部消息的送达条件：'idle' 等 agent 空闲，'step' 任意步边界，'now' 取消当前这一步后立即插入 */
export type When = 'idle' | 'step' | 'now' | ((boundary: Boundary) => boolean)

/** 会话中尚未送达的消息 */
export interface PendingMessage {
  message: Message
  when: When
}
