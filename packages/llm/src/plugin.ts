import type { AssistantMessage, AssistantMessageEvent, ToolResultMessage } from '@mariozechner/pi-ai'
import type { Extension } from '@pi-rsi/kernel'
import type { EnvUpdateExtension } from '@pi-rsi/kernel/advanced'
import type { AgentAction, AgentState, AgentTool, LLMExtension, ToolContext, ToolRunner } from './types.ts'
import { liftWiden } from '@pi-rsi/kernel/advanced'
import { isHistoryRewrite } from './history.ts'

/** 插件自己的状态：纯 reducer，每步 update 之后运行，结果存在 AgentState.plugins[name] */
export interface PluginState<State> {
  init: State
  reduce: (own: State, msg: AssistantMessage, results: ToolResultMessage[]) => State
}

/** 所有钩子的形状都是 (input, next)：不调用 next 即拦截，调用多次即重试 */
export interface PluginSpec<State = undefined> {
  name: string
  /** 注册工具。重名在 createAgent 时报错 */
  tools?: AgentTool[]
  /** 修改 system prompt */
  system?: (prompt: string) => string
  /** 包装每一次工具调用 */
  tool?: (ctx: ToolContext, next: ToolRunner) => Promise<ToolResultMessage>
  /** 包装模型调用。除了返回 next 的结果，还可以返回 rewriteHistory(...) 替换历史 */
  policy?: ActionExtension<AgentAction>['policy']
  /** 包装一个助手回合的全部工具执行 */
  env?: ActionExtension<AssistantMessage>['env']
  /** 包装状态更新。必须同步、纯 */
  update?: ActionExtension<AssistantMessage>['update']
  /** 插件自己的状态 */
  state?: PluginState<State>
}

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

/**
 * 插件 → 内核中间件。env / update 与状态 reducer 只处理助手回合：
 * 经 liftWiden 提升后，HistoryRewrite 直接跳过它们
 */
export function extensionsOf(plugin: AnyPlugin): LLMExtension[] {
  const { name, policy, env, update, state, select } = plugin
  const extensions: LLMExtension[] = [{ policy }, liftWiden({ env, update }, isHistoryRewrite)]

  if (state) {
    const reducer: EnvUpdateExtension<AgentState, AssistantMessage, ToolResultMessage[]> = {
      update: (s, msg, results, next) => {
        const updated = next(s, msg, results)
        const own = state.reduce(select(updated), msg, results)
        return { ...updated, plugins: { ...updated.plugins, [name]: own } }
      },
    }
    extensions.push(liftWiden(reducer, isHistoryRewrite))
  }

  return extensions
}

type ActionExtension<A> = Extension<AgentState, A, ToolResultMessage[], AssistantMessage, AssistantMessageEvent>

function duplicateNames(items: ReadonlyArray<{ name: string }>): string[] {
  return [...Map.groupBy(new Set(items), item => item.name)]
    .filter(([, group]) => group.length > 1)
    .map(([name]) => name)
}
