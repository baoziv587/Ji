import type { AssistantMessage, Message, ToolCall, ToolResultMessage } from '@earendil-works/pi-ai/compat'
import type { Extension, Step, Stream } from '@ji.dev/kernel'
import type { Lens } from '@ji.dev/kernel/advanced'
import type {
  AgentAction,
  AgentState,
  AgentTool,
  ModelCall,
  ModelRequest,
  Payload,
  RunEvent,
  RunInfo,
  ToolRunner,
  Turn,
} from './types.ts'
import { duplicatesBy, sameData, warn } from '@ji.dev/utils'
import { callsOf } from './message.ts'
import { actionOf, isModelAction, turnOf } from './turn.ts'

/**
 * Fields are listed in the order they run within a step (RFC-0004 §4). Two shapes (RFC-0006 §3):
 *
 *   transform    (value, ctx) => value | Promise<value>           input: plugins run in list order
 *   middleware   (input, next, ctx) => Stream<Payload, output>    decide, request, toolCalls, toolCall: earlier plugins
 *                                                                  are outer, so they see the input first
 *
 * The middleware are streams: `yield` adds an event to the run, `return` gives the result, `yield* next(...)` passes
 * the inner layers' events through (RFC-0005 §3.2). system, record and state.reduce are pure and get no ctx.
 */
export interface PluginSpec<State = undefined> {
  name: string
  /** Name clashes with other tools throw at createAgent. */
  tools?: AgentTool[]
  /** Transform, run once at createAgent. */
  system?: (prompt: string) => string
  /**
   * Middleware that decides what this step does: insert messages, call the model, or return rewriteHistory(...) to
   * replace history or stop(state) to end. ctx.complete calls a model of the plugin's own. The tool calls of the model's
   * reply run afterwards, in toolCalls: when next returns, no tool has run yet.
   */
  decide?: (state: AgentState, next: DecideNext, ctx: DecideContext<State>) => DecideStream
  /** Transform of the messages to insert at this boundary; starts with the queued messages deliverable now. */
  input?: (messages: Message[], ctx: InputContext<State>) => Message[] | Promise<Message[]>
  /**
   * Middleware around one model call, the main model's and every ctx.complete alike (ctx.by tells them apart).
   * Changing req.messages changes only what this request sends, never the history: `before` it for retrieval or
   * windowing, and leave requests with a ctx.by alone unless they should change too.
   */
  request?: (req: ModelRequest, next: ModelCall, ctx: RequestContext<State>) => Stream<Payload, AssistantMessage>
  /** Middleware around all tool calls of one model turn; turns without tool calls, the final answer included, skip it. */
  toolCalls?: (
    message: AssistantMessage,
    next: ToolCallsRunner,
    ctx: HookContext<State>,
  ) => Stream<Payload, ToolResultMessage[]>
  /** Middleware around one tool call. Throw for failures a retry may fix; return toolError(...) for expected ones. */
  toolCall?: (call: ToolCall, next: ToolRunner, ctx: HookContext<State>) => Stream<Payload, ToolResultMessage>
  /** Middleware that writes history. Must be synchronous and pure; sees every Turn. */
  record?: (input: RecordInput, next: (input: RecordInput) => AgentState) => AgentState
  state?: PluginState<State>
  /**
   * Read-only: receives every event of every run of the agent, in order, from the first one. Called synchronously and
   * never awaited; anything thrown, or a promise returned, is reported as a warning, so the run is never affected.
   */
  observe?: (e: RunEvent, run: RunInfo) => void
}

/** A pure reducer run after each step's record; its result is stored in AgentState.plugins[name]. */
export interface PluginState<State> {
  init: State
  reduce: (own: State, turn: Turn) => State
}

/** What every hook with a ctx gets. One snapshot per step: all hooks of a step see the same values. */
export interface HookContext<State = undefined> {
  /** The state committed before this step started. */
  readonly state: AgentState
  /** This plugin's own state: plugin.select(ctx.state). */
  readonly own: State
  /** Fires when this step is interrupted or the run is aborted. Pass it to any IO the hook starts. */
  readonly signal: AbortSignal
}

export interface InputContext<State = undefined> extends HookContext<State> {
  /** History is empty, or its last message is an assistant message without tool calls. */
  readonly idle: boolean
}

export interface DecideContext<State = undefined> extends HookContext<State> {
  /**
   * Calls a model through the agent's request chain, so fallback and other request plugins apply. Its model events
   * carry `by: <plugin name>` and its usage counts in r.summary; its thinking, text and tool calls are not streamed.
   * One call at a time: running several at once is not supported.
   */
  complete: (req: CompleteRequest, options?: CallOptions) => Stream<Payload, AssistantMessage>
}

/** No `complete` here: it would go through this very hook again. */
export interface RequestContext<State = undefined> extends HookContext<State> {
  /** The plugin whose ctx.complete made this request; undefined for the main model. */
  readonly by?: string
}

/** Only messages are required. model, thinking and options default to the agent's; systemPrompt and tools to empty. */
export type CompleteRequest = Pick<ModelRequest, 'messages'> & Partial<Omit<ModelRequest, 'messages' | 'state'>>

export interface CallOptions {
  /** Merged with the step's signal: it can cut this one call short, never outlive a cancelled step. */
  signal?: AbortSignal
}

export interface RecordInput {
  state: AgentState
  turn: Turn
}

export type DecideStream = Stream<Payload, Step<AgentAction, AssistantMessage>>

export type DecideNext = (state: AgentState) => DecideStream

export type ToolCallsRunner = (message: AssistantMessage) => Stream<Payload, ToolResultMessage[]>

export interface Plugin<State = undefined> extends PluginSpec<State> {
  /** Returns state.init until this plugin's state has been written. Inside its own hooks, ctx.own is the same. */
  select: (s: AgentState) => State
}

/** `any`, not `unknown`: State is contravariant in reduce, so Plugin<{ n: number }> won't fit Plugin<unknown>. */
export type AnyPlugin = Plugin<any>

/** May nest, so several plugins can ship as one preset; nesting does not change the order. */
export type PluginList = ReadonlyArray<AnyPlugin | PluginList>

/**
 * Overloads, so a plugin without `state` gets concrete ctx types: otherwise State would still be open while TS types
 * a helper's callback, and `before((req, { by }) => …)` would see only the helpers' bare ctx (no by, own, complete).
 */
export function definePlugin<State>(spec: PluginSpec<State> & { state: PluginState<State> }): Plugin<State>
export function definePlugin(spec: PluginSpec): Plugin
export function definePlugin<State>(spec: PluginSpec<State>): Plugin<State> {
  const { name, state } = spec
  return { ...spec, select: pluginStateSlot(name, state?.init as State).get }
}

/**
 * The place inside AgentState where one plugin keeps its own data: `state.plugins[name]`.
 *
 *   get(state)       reads the plugin's data; `init` until something has been written
 *   set(state, own)  returns a copy of state with the plugin's data replaced; nothing else changes
 *
 * plugin.select is `get`. After every step, the plugin's state reducer reads with `get` and writes with `set`.
 *
 * Three rules keep saved and resumed state reliable (tested in tests/plugin.test.ts; in kernel terms this is a Lens):
 *   - reading right after a write gives back what was written
 *   - of two writes in a row, only the last one counts
 *   - writing back what was just read changes nothing (an empty slot gets `init` written in, which reads the same)
 */
export function pluginStateSlot<State>(name: string, init: State): Lens<AgentState, State> {
  return {
    get: s => (Object.hasOwn(s.plugins, name) ? (s.plugins[name] as State) : init),
    set: (s, own) => ({ ...s, plugins: { ...s.plugins, [name]: own } }),
  }
}

/** Thrown by createAgent with every duplicate tool and plugin name at once. */
export class PluginConflictError extends Error {
  readonly conflicts: { tools: string[]; plugins: string[] }

  constructor(conflicts: { tools: string[]; plugins: string[] }) {
    const names = [
      ...conflicts.tools.map(name => `tool "${name}"`),
      ...conflicts.plugins.map(name => `plugin "${name}"`),
    ]
    super(`duplicate names: ${names.join(', ')}`)
    this.name = 'PluginConflictError'
    this.conflicts = conflicts
  }
}

/**
 * Flattens nested presets and keeps each plugin object once, where it first appears (RFC-0006 §6.1):
 * [a, [b, a]] is [a, b]. Only the same object counts as the same plugin; two objects sharing a name still conflict.
 */
export function pluginsOf(list: PluginList): AnyPlugin[] {
  return [...new Set(flatten(list))]
}

/** Only distinct objects sharing a name conflict; registering the same object twice is fine. */
export function assertNoConflicts(tools: AgentTool[], plugins: AnyPlugin[]): void {
  const conflicts = { tools: duplicatesBy(tools, t => t.name), plugins: duplicatesBy(plugins, p => p.name) }

  if (conflicts.tools.length > 0 || conflicts.plugins.length > 0) {
    throw new PluginConflictError(conflicts)
  }
}

/** Builds the ctx of each hook for the step in progress. */
export interface HookContexts {
  of: (plugin: AnyPlugin) => HookContext<unknown>
  decide: (plugin: AnyPlugin) => DecideContext<unknown>
}

type LLMExtension = Extension<AgentState, AgentAction, ToolResultMessage[], AssistantMessage, Payload>

/**
 * Plugin decide / toolCalls / record / state -> kernel middleware (decide wraps the kernel's policy, toolCalls its env).
 * record and state work on Turns, so this converts to and from the kernel's (action, obs); state.reduce runs on the
 * result of this plugin's record, inside its own layer.
 *
 * With `checkDeterminism`, state.reduce runs twice on the same input; if the results differ, the plugin gets one
 * DeterminismWarning and the first result is kept (RFC-0006 §8).
 */
export function extensionOf(plugin: AnyPlugin, contexts: HookContexts, checkDeterminism: boolean): LLMExtension {
  const { name, decide, toolCalls, record, state } = plugin
  const ext: LLMExtension = {}

  if (decide) {
    ext.policy = (s, next) => decide(s, next, contexts.decide(plugin))
  }

  if (toolCalls) {
    ext.env = (action, next) => (hasToolCalls(action) ? toolCalls(action, next, contexts.of(plugin)) : next(action))
  }

  if (record || state) {
    const slot = state ? pluginStateSlot(name, state.init) : undefined

    ext.update = (s, action, results, next) => {
      const input = { state: s, turn: turnOf(action, results) }
      const inner = ({ state: s2, turn: turn2 }: RecordInput): AgentState => next(s2, ...actionOf(turn2))
      const updated = record ? record(input, inner) : inner(input)

      if (!state || !slot) {
        return updated
      }

      const own = slot.get(updated)
      const reduced = state.reduce(own, input.turn)
      if (checkDeterminism) {
        checkReduce(plugin, reduced, state.reduce(own, input.turn))
      }
      return slot.set(updated, reduced)
    }
  }

  return ext
}

/** Plugins already warned about; each gets at most one DeterminismWarning. */
const unstable = new WeakSet<AnyPlugin>()

function checkReduce(plugin: AnyPlugin, first: unknown, again: unknown): void {
  if (sameData(first, again) || unstable.has(plugin)) {
    return
  }

  unstable.add(plugin)
  warn(
    `state.reduce of plugin "${plugin.name}" returned different results for the same input; it must be pure. ` +
      'The first result was kept.',
    'DeterminismWarning',
  )
}

function flatten(list: PluginList): AnyPlugin[] {
  return list.flatMap(item => (Array.isArray(item) ? flatten(item) : [item as AnyPlugin]))
}

function hasToolCalls(action: AgentAction): action is AssistantMessage {
  return isModelAction(action) && callsOf(action).length > 0
}
