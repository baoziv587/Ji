import type { Agent as KernelAgent, Stream } from '@ji.dev/kernel'
import type {
  Api,
  AssistantMessage,
  Message,
  Model,
  ModelThinkingLevel,
  SimpleStreamOptions,
  Static,
  Tool,
  ToolCall,
  ToolResultMessage,
  TSchema,
  Usage,
} from '@mariozechner/pi-ai'
import type { RunError } from './errors.ts'

/** `plugins` is keyed by plugin name. */
export interface AgentState {
  messages: Message[]
  plugins: Readonly<Record<string, unknown>>
}

/**
 * One record per step. record, plugin state.reduce and Run.turns all see the same sequence (I13).
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

/** How hard the model thinks. The same as pi-ai's ModelThinkingLevel: 'off' included. */
export type ThinkingLevel = ModelThinkingLevel

/** Everything a model call needs; a request hook may change any field except `state`. */
export interface ModelRequest {
  model: Model<Api>
  systemPrompt: string
  /** Starts as the stored history; request hooks may change it for this request only. */
  messages: Message[]
  tools: Tool[]
  /** Mapped to the nearest level the request's model supports; model_start reports the level actually sent. */
  thinking: ThinkingLevel
  options: StreamOptions
  /** Read-only. */
  state: AgentState
}

/** pi-ai stream options sent with every model call; the signal belongs to the step and the level to `thinking`. */
export type StreamOptions = Omit<SimpleStreamOptions, 'signal' | 'reasoning'>

export type ModelCall = (req: ModelRequest) => Stream<Payload, AssistantMessage>

/** Instantiated once per Run segment from the result of createAgent. */
export type LLMAgent = KernelAgent<AgentState, AgentAction, ToolResultMessage[], AssistantMessage, Payload>

/**
 * What a tool returns: its text for the model, or the text plus `details` for plugins and programs (the model never
 * sees them). `isError: true` reports an expected failure as a result, like toolError: a retry never sees it.
 */
export type ToolOutput = string | { text: string; details?: unknown; isError?: boolean }

/**
 * A pi-ai Tool (TypeBox schema) plus `run`. `run` may be an async generator: every value it yields becomes a
 * tool_update event, and what it returns is the result.
 */
export type AgentTool<T extends TSchema = TSchema> = Tool<T> & {
  /** Method syntax on purpose: its parameters are bivariant, so AgentTool<SpecificSchema> fits in AgentTool[]. */
  // eslint-disable-next-line ts/method-signature-style
  run(args: Static<T>, signal: AbortSignal): ToolOutput | Promise<ToolOutput> | Stream<unknown, ToolOutput>
}

/** Runs one tool call. The agent turns anything thrown into an isError result for the model (I8). */
export type ToolRunner = (call: ToolCall) => Stream<Payload, ToolResultMessage>

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

/** Which model a request went to. */
export interface ModelRef {
  provider: string
  id: string
}

type Empty = Record<never, never>

/**
 * Every event of a run, keyed by type (RFC-0005 §3.3). Open: a plugin adds its own events with declaration merging,
 * named `<plugin>:<event>`:
 *
 *     declare module '@ji.dev/llm' {
 *       interface Events { 'compaction:start': { tokens: number } }
 *     }
 *
 * step_start, step_end, step_cancelled and run_end come from the Run; every other event is yielded by some layer.
 */
export interface Events {
  step_start: Empty
  /** The same record as each item of r.turns. */
  step_end: Omit<TurnEvent, 't'>
  /** The step was dropped uncommitted; `open` lists the tool calls that had started but not ended. */
  step_cancelled: { reason: 'interrupt' | 'abort' | 'error'; open: ToolCall[] }
  /**
   * The request actually sent: after request plugins, with the thinking level the model supports. Each model_start is
   * closed by exactly one model_end, model_error or step_cancelled; at most one is open at a time (RFC-0006 §5.4).
   * `by` names the plugin whose ctx.complete made the call; the main model's calls have none.
   */
  model_start: { model: ModelRef; thinking: ThinkingLevel; by?: string }
  /** Main model only: a plugin's ctx.complete does not stream its content. */
  thinking: { delta: string }
  text: { delta: string }
  /**
   * The model is writing this call's arguments: `call` has those it has written so far, `delta` the next of their JSON.
   * `call.id` is the id its tool_call will have.
   */
  tool_call_delta: { call: ToolCall; delta: string }
  /** The model finished writing this call's arguments; the tool has not started. */
  tool_call: { call: ToolCall }
  model_end: { message: AssistantMessage; ms: number; by?: string }
  /** The provider reported a failure; a request plugin may still retry. `usage` is what the provider billed, if any. */
  model_error: { error: Error; usage?: Usage; ms: number; by?: string }
  tool_start: { call: ToolCall }
  /** A value the tool yielded, of any type. */
  tool_update: { call: ToolCall; data: unknown }
  tool_end: { call: ToolCall; result: ToolResultMessage; ms: number }
  run_end:
    | { outcome: 'done'; result: AssistantMessage; summary: RunSummary }
    | { outcome: 'failed'; error: RunError; summary: RunSummary }
}

/** An event without its step number: what the layers yield. */
export type Payload = { [K in keyof Events]: { type: K } & Events[K] }[keyof Events]

export type RunEvent = Payload & { t: number }

/** Passed to observe along with each event, to tell runs and sessions sharing one agent apart. */
export interface RunInfo {
  id: string
  session: string
}

export interface RunSummary {
  /** Number of model turns. */
  turns: number
  /**
   * Summed over every model_end and model_error published, plugin calls included; a step that is later cancelled,
   * stopped or rewritten keeps what it already spent. So it can exceed the usageOf difference of the history.
   */
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
