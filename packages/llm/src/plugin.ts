import type { AssistantMessage, AssistantMessageEvent, Message, ToolResultMessage } from '@mariozechner/pi-ai'
import type { Extension, Step, Stream } from '@pi-rsi/kernel'
import type { AgentAction, AgentState, AgentTool, Boundary, ModelCall, ModelRequest, ToolContext, ToolRunner, Turn } from './types.ts'
import { callsOf } from './message.ts'
import { actionOf, isModelAction, turnOf } from './turn.ts'

/** 插件自己的状态：纯 reducer，每一步 update 之后运行，结果存在 AgentState.plugins[name] */
export interface PluginState<State> {
  init: State
  reduce: (own: State, turn: Turn) => State
}

/**
 * 字段按一步中的执行顺序排列（RFC-0004 §4）。
 * 变换 (value, context) => value 按插件顺序依次执行；中间件 (input, next) => output 前面的在内层。
 */
export interface PluginSpec<State = undefined> {
  name: string
  /** 注册工具。重名在 createAgent 时报错 */
  tools?: AgentTool[]
  /** 变换：修改 system prompt，创建 agent 时执行一次 */
  system?: (prompt: string) => string
  /** 中间件：整一步。可以返回 rewriteHistory(...) 替换历史，或 stop(state) 结束 */
  policy?: (state: AgentState, next: (state: AgentState) => PolicyStream) => PolicyStream
  /** 变换：这个步边界要插入的消息。初始值是此刻可以送达的外部消息 */
  input?: (messages: Message[], boundary: Boundary) => Message[] | Promise<Message[]>
  /** 变换：这次请求发给模型的消息，不改历史 */
  context?: (messages: Message[], state: AgentState) => Message[] | Promise<Message[]>
  /** 中间件：一次模型调用 */
  request?: (req: ModelRequest, next: ModelCall) => Stream<AssistantMessageEvent, AssistantMessage>
  /** 中间件：一个模型回合的全部工具调用。没有工具调用的回合不经过它 */
  env?: (msg: AssistantMessage, next: (msg: AssistantMessage) => Promise<ToolResultMessage[]>) => Promise<ToolResultMessage[]>
  /** 中间件：一次工具调用 */
  tool?: (ctx: ToolContext, next: ToolRunner) => Promise<ToolResultMessage>
  /** 中间件：写入状态。必须同步、纯；看到所有 Turn */
  update?: (state: AgentState, turn: Turn, next: (state: AgentState, turn: Turn) => AgentState) => AgentState
  /** 插件自己的状态 */
  state?: PluginState<State>
}

export type PolicyStream = Stream<AssistantMessageEvent, Step<AgentAction, AssistantMessage>>

export interface Plugin<State = undefined> extends PluginSpec<State> {
  /** 读取本插件的状态；尚未写入时返回 state.init */
  select: (s: AgentState) => State
}

/** 任意状态类型的插件。State 在 reduce 中是逆变的，Plugin<{ n: number }> 不能赋给 Plugin<unknown>，只能用 any */
export type AnyPlugin = Plugin<any>

/** 插件数组可以嵌套，方便把几个插件打包成预设 */
export type PluginList = ReadonlyArray<AnyPlugin | PluginList>

export function definePlugin<State = undefined>(spec: PluginSpec<State>): Plugin<State> {
  const { name, state } = spec

  return {
    ...spec,
    select: s => (Object.hasOwn(s.plugins, name) ? s.plugins[name] : state?.init) as State,
  }
}

/** 工具或插件重名。createAgent 一次报出全部冲突 */
export class PluginConflictError extends Error {
  readonly conflicts: { tools: string[], plugins: string[] }

  constructor(conflicts: { tools: string[], plugins: string[] }) {
    const names = [
      ...conflicts.tools.map(name => `tool "${name}"`),
      ...conflicts.plugins.map(name => `plugin "${name}"`),
    ]
    super(`duplicate names: ${names.join(', ')}`)
    this.name = 'PluginConflictError'
    this.conflicts = conflicts
  }
}

/* ── 供 createAgent 使用 ─────────────────────────────── */

export function flattenPlugins(list: PluginList): AnyPlugin[] {
  return list.flatMap(item => (Array.isArray(item) ? flattenPlugins(item) : [item as AnyPlugin]))
}

/** 同一个对象登记多次不算冲突；不同对象同名才算 */
export function assertNoConflicts(tools: AgentTool[], plugins: AnyPlugin[]): void {
  const conflicts = { tools: duplicateNames(tools), plugins: duplicateNames(plugins) }

  if (conflicts.tools.length > 0 || conflicts.plugins.length > 0) {
    throw new PluginConflictError(conflicts)
  }
}

type LLMExtension = Extension<AgentState, AgentAction, ToolResultMessage[], AssistantMessage, AssistantMessageEvent>

/**
 * 插件的 policy / env / update / state → 内核中间件。
 * env 只包装带工具调用的模型回合；update 和 state 看到的是 Turn，这里负责与内核的 (action, obs) 互转。
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
      return { ...updated, plugins: { ...updated.plugins, [name]: state.reduce(select(updated), turn) } }
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
