import type { Api, AssistantMessage, AssistantMessageEvent, Message, Model, SimpleStreamOptions, ToolResultMessage } from '@mariozechner/pi-ai'
import type { Agent, Stream } from '@pi-rsi/kernel'
import type { AnyPlugin, PluginList } from './plugin.ts'
import type { AgentEvent, AgentState, AgentTool, LLMAgent, ToolRunner } from './types.ts'
import { streamSimple } from '@mariozechner/pi-ai'
import { act, done, extend, run as runKernel, unfold } from '@pi-rsi/kernel'
import { widen } from '@pi-rsi/kernel/advanced'
import { isHistoryRewrite } from './history.ts'
import { callsOf } from './message.ts'
import { assertNoConflicts, extensionsOf, flattenPlugins } from './plugin.ts'
import { toolError, toolRunner } from './tool.ts'

export interface AgentOptions extends SimpleStreamOptions {
  model: Model<Api>
  system?: string
  tools?: AgentTool[]
  /** 前面的在内层，后面的在外层。可以嵌套 */
  plugins?: PluginList
}

/** 唯一的装配入口。工具或插件重名时抛 PluginConflictError，列出全部冲突 */
export function createAgent(options: AgentOptions): LLMAgent {
  const { model, system = '', tools = [], plugins = [], ...streamOptions } = options

  const list = flattenPlugins(plugins)
  const allTools = [...new Set([...tools, ...list.flatMap(p => p.tools ?? [])])]
  assertNoConflicts(allTools, list)

  const prompt = list.reduce((acc, p) => p.system?.(acc) ?? acc, system)
  const runTool = list.reduce(wrapToolRunner, toolRunner(allTools))

  const turns = turnAgent({ model, system: prompt, tools: allTools, runTool, streamOptions })
  const base = widen(turns, isHistoryRewrite, {
    env: async () => [],
    update: (state, rewrite) => ({ ...state, messages: rewrite.messages }),
  })
  return extend(base, ...list.flatMap(extensionsOf))
}

/** 输入是消息列表时从空的插件状态开始；是 AgentState 时从该状态继续（恢复、热插拔） */
export type AgentInput = AgentState | Message[]

export function stream(agent: LLMAgent, input: AgentInput, maxSteps?: number): Stream<AgentEvent, void> {
  return unfold(agent, toState(input), maxSteps)
}

export function run(agent: LLMAgent, input: AgentInput, maxSteps?: number): Promise<AssistantMessage> {
  return runKernel(agent, toState(input), maxSteps)
}

export function initialState(messages: Message[]): AgentState {
  return { messages, plugins: {} }
}

/* ── 内部 ─────────────────────────────────────────────── */

interface TurnOptions {
  model: Model<Api>
  system: string
  tools: AgentTool[]
  runTool: ToolRunner
  streamOptions: SimpleStreamOptions
}

/** 只处理助手回合的 agent；HistoryRewrite 由 createAgent 用 widen 加上 */
type TurnAgent = Agent<AgentState, AssistantMessage, ToolResultMessage[], AssistantMessage, AssistantMessageEvent>

function turnAgent({ model, system, tools, runTool, streamOptions }: TurnOptions): TurnAgent {
  const specs = tools.map(({ name, description, parameters }) => ({ name, description, parameters }))
  const systemPrompt = system === '' ? undefined : system
  const signal = streamOptions.signal ?? new AbortController().signal // 未传入时是一个永不中止的 signal

  return {
    // π：转发 pi-ai 的事件流；消费方 break（generator.return）→ abort 底层请求
    async* policy(state) {
      const ctl = new AbortController()
      const requestSignal = AbortSignal.any([signal, ctl.signal])
      const events = streamSimple(model, { systemPrompt, messages: state.messages, tools: specs }, { ...streamOptions, signal: requestSignal })

      let finished = false
      try {
        yield* events
        finished = true
      }
      finally {
        if (!finished) {
          ctl.abort()
        }
      }

      const msg = await events.result()
      if (msg.stopReason === 'error' || msg.stopReason === 'aborted') {
        throw new Error(`${model.provider}/${model.id} ${msg.stopReason}: ${msg.errorMessage}`)
      }

      return callsOf(msg).length > 0 ? act(msg) : done(msg)
    },

    // ε：并行执行；中间件或工具抛出的异常都转为 isError 结果交还模型（I8）
    env: msg => Promise.all(
      callsOf(msg).map(call => runTool({ call, signal }).catch(e => toolError(call, e))),
    ),

    // δ：只追加
    update: (state, msg, results) => ({ ...state, messages: [...state.messages, msg, ...results] }),
  }
}

function wrapToolRunner(next: ToolRunner, plugin: AnyPlugin): ToolRunner {
  const { tool } = plugin
  return tool ? ctx => tool(ctx, next) : next
}

function toState(input: AgentInput): AgentState {
  return Array.isArray(input) ? initialState(input) : input
}
