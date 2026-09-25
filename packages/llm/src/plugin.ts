import type { Extension, Step, Stream } from '@gaoxiang.ai/kernel'
import type { AssistantMessage, AssistantMessageEvent, Message, ToolResultMessage } from '@mariozechner/pi-ai'
import type {
  AgentAction,
  AgentState,
  AgentTool,
  Boundary,
  ModelCall,
  ModelRequest,
  ToolContext,
  ToolRunner,
  Turn,
} from './types.ts'
import { callsOf } from './message.ts'
import { actionOf, isModelAction, turnOf } from './turn.ts'

/** A pure reducer run after each step's update; its result is stored in AgentState.plugins[name]. */
export interface PluginState<State> {
  init: State
  reduce: (own: State, turn: Turn) => State
}

/**
 * Fields are listed in the order they run within a step (RFC-0004 §4).
 * Transforms `(value, context) => value` run in plugin order; for middleware `(input, next) => output`,
 * earlier plugins are nested inside later ones.
 */
export interface PluginSpec<State = undefined> {
  name: string
  /** Name clashes with other tools throw at createAgent. */
  tools?: AgentTool[]
  /** Transform, run once at createAgent. */
  system?: (prompt: string) => string
  /** Middleware around the whole step. May return rewriteHistory(...) to replace history, or stop(state) to end. */
  policy?: (state: AgentState, next: (state: AgentState) => PolicyStream) => PolicyStream
  /** Transform of the messages to insert at this boundary; starts with the queued messages deliverable now. */
  input?: (messages: Message[], boundary: Boundary) => Message[] | Promise<Message[]>
  /** Transform of the messages sent in this request only; history is untouched. */
  context?: (messages: Message[], state: AgentState) => Message[] | Promise<Message[]>
  /** Middleware around one model call. */
  request?: (req: ModelRequest, next: ModelCall) => Stream<AssistantMessageEvent, AssistantMessage>
  /** Middleware around all tool calls of one model turn; turns without tool calls skip it. */
  env?: (
    msg: AssistantMessage,
    next: (msg: AssistantMessage) => Promise<ToolResultMessage[]>,
  ) => Promise<ToolResultMessage[]>
  /** Middleware around one tool call. */
  tool?: (ctx: ToolContext, next: ToolRunner) => Promise<ToolResultMessage>
  /** Middleware that writes state. Must be synchronous and pure; sees every Turn. */
  update?: (state: AgentState, turn: Turn, next: (state: AgentState, turn: Turn) => AgentState) => AgentState
  state?: PluginState<State>
}

export type PolicyStream = Stream<AssistantMessageEvent, Step<AgentAction, AssistantMessage>>

export interface Plugin<State = undefined> extends PluginSpec<State> {
  /** Returns state.init until this plugin's state has been written. */
  select: (s: AgentState) => State
}

/** `any`, not `unknown`: State is contravariant in reduce, so Plugin<{ n: number }> won't fit Plugin<unknown>. */
export type AnyPlugin = Plugin<any>

/** May nest, so several plugins can ship as one preset; nesting does not change the order. */
export type PluginList = ReadonlyArray<AnyPlugin | PluginList>

export function definePlugin<State = undefined>(spec: PluginSpec<State>): Plugin<State> {
  const { name, state } = spec

  return {
    ...spec,
    select: s => (Object.hasOwn(s.plugins, name) ? s.plugins[name] : state?.init) as State,
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

export function flattenPlugins(list: PluginList): AnyPlugin[] {
  return list.flatMap(item => (Array.isArray(item) ? flattenPlugins(item) : [item as AnyPlugin]))
}

/** Only distinct objects sharing a name conflict; registering the same object twice is fine. */
export function assertNoConflicts(tools: AgentTool[], plugins: AnyPlugin[]): void {
  const conflicts = { tools: duplicateNames(tools), plugins: duplicateNames(plugins) }

  if (conflicts.tools.length > 0 || conflicts.plugins.length > 0) {
    throw new PluginConflictError(conflicts)
  }
}

type LLMExtension = Extension<AgentState, AgentAction, ToolResultMessage[], AssistantMessage, AssistantMessageEvent>

/**
 * Plugin policy / env / update / state -> kernel middleware. update and state work on Turns, so this converts to and
 * from the kernel's (action, obs); state.reduce runs on the result of this plugin's update, inside its own layer.
 */
export function extensionOf(plugin: AnyPlugin): LLMExtension {
  const { name, policy, env, update, state, select } = plugin
  const ext: LLMExtension = { policy }

  if (env) {
    ext.env = (action, next) => (hasToolCalls(action) ? env(action, next) : next(action))
  }

  if (update || state) {
    ext.update = (s, action, results, next) => {
      const turn = turnOf(action, results)
      const inner = (s2: AgentState, turn2: Turn): AgentState => next(s2, ...actionOf(turn2))
      const updated = update ? update(s, turn, inner) : inner(s, turn)

      if (!state) {
        return updated
      }
      return {
        ...updated,
        plugins: { ...updated.plugins, [name]: state.reduce(select(updated), turn) },
      }
    }
  }

  return ext
}

function hasToolCalls(action: AgentAction): action is AssistantMessage {
  return isModelAction(action) && callsOf(action).length > 0
}

function duplicateNames(items: ReadonlyArray<{ name: string }>): string[] {
  return [...Map.groupBy(new Set(items), item => item.name)]
    .filter(([, group]) => group.length > 1)
    .map(([name]) => name)
}
