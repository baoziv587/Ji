import type { Event, Agent as KernelAgent, Stream } from '@gaoxiang.ai/kernel'
import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Message,
  Model,
  SimpleStreamOptions,
  Static,
  Tool,
  ToolCall,
  ToolResultMessage,
  TSchema,
} from '@mariozechner/pi-ai'

/** `plugins` is keyed by plugin name. */
export interface AgentState {
  messages: Message[]
  plugins: Readonly<Record<string, unknown>>
}

/**
 * One record per step. update, plugin state.reduce and Run.turns all see the same sequence (I13).
 * The final answer is a 'model' turn with `results: []`.
 */
export type Turn =
  | { kind: 'model'; message: AssistantMessage; results: ToolResultMessage[] }
  | InputAction
  | RewriteAction

export interface InputAction {
  kind: 'input'
  messages: Message[]
  /** Whether the agent was idle when the messages were inserted. */
  idle: boolean
  /** Whether this step boundary was produced by an interrupt. */
  interrupted: boolean
}

export interface RewriteAction {
  kind: 'rewrite'
  messages: Message[]
}

export type AgentAction = AssistantMessage | InputAction | RewriteAction

/** Between two steps: the model is not streaming and no tool is running. */
export interface Boundary {
  state: AgentState
  /** History is empty, or its last message is an assistant message without tool calls. */
  idle: boolean
}

/** Everything a model call needs; a request hook may change any field except `state`. */
export interface ModelRequest {
  model: Model<Api>
  systemPrompt: string
  /** Output of the context hooks, not the stored history. */
  messages: Message[]
  tools: Tool[]
  options: SimpleStreamOptions
  /** Read-only. */
  state: AgentState
}

export type ModelCall = (req: ModelRequest) => Stream<AssistantMessageEvent, AssistantMessage>

/** Instantiated once per Run from the result of createAgent. */
export type LLMAgent = KernelAgent<
  AgentState,
  AgentAction,
  ToolResultMessage[],
  AssistantMessage,
  AssistantMessageEvent
>
export type AgentEvent = Event<AgentState, AgentAction, ToolResultMessage[], AssistantMessage, AssistantMessageEvent>

/** A pi-ai Tool (TypeBox schema) plus `run`. */
export type AgentTool<T extends TSchema = TSchema> = Tool<T> & {
  /** Method syntax on purpose: its parameters are bivariant, so AgentTool<SpecificSchema> fits in AgentTool[]. */
  // eslint-disable-next-line ts/method-signature-style
  run(args: Static<T>, signal: AbortSignal): string | Promise<string>
}

export interface ToolContext {
  call: ToolCall
  signal: AbortSignal
}

/** Runs one tool call. The agent turns anything thrown into an isError result for the model (I8). */
export type ToolRunner = (ctx: ToolContext) => Promise<ToolResultMessage>

/** `cost` is in USD, as priced by the provider. */
export interface UsageTotals {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cost: number
}

export interface TurnTiming {
  ms: number
  /** Model turns only: from the start of the step to the end of model output. */
  modelMs?: number
  /** Model turns only: to the first content delta (text, thinking or tool arguments). */
  firstTokenMs?: number
  /** Model turns only: keyed by toolCall.id. */
  toolMs?: Record<string, number>
}

export interface RunSummary {
  /** Number of model turns. */
  turns: number
  usage: UsageTotals
  modelMs: number
  /** Sum over tool calls; parallel calls overlap, so this can exceed wall-clock time. */
  toolMs: number
  /** Keyed by tool name. */
  tools: Record<string, { calls: number; errors: number; ms: number }>
  /** Number of inserted external messages. */
  inputs: number
  /** Number of times the history was replaced. */
  rewrites: number
}

export interface TurnEvent {
  t: number
  turn: Turn
  /** State after this step. */
  state: AgentState
  timing: TurnTiming
  /** Run stats up to and including this step. */
  summary: RunSummary
}

/**
 * When a queued message may be delivered: 'idle' waits until the agent is idle, 'step' takes any step boundary,
 * 'now' cancels the current step and inserts at once.
 */
export type When = 'idle' | 'step' | 'now' | ((boundary: Boundary) => boolean)

/** A message queued in the session, not yet delivered. */
export interface PendingMessage {
  message: Message
  when: When
}
