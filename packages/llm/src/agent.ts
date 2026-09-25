import type { Api, AssistantMessage, Message, Model, SimpleStreamOptions, ToolResultMessage } from '@mariozechner/pi-ai'
import type { AnyPlugin, PluginList } from './plugin.ts'
import type { AgentTool, Boundary, LLMAgent, ModelCall, ToolRunner } from './types.ts'
import { performance } from 'node:perf_hooks'
import { act, extend } from '@gaoxiang.ai/kernel'
import { clampThinkingLevel, streamSimple } from '@mariozechner/pi-ai'
import { callsOf, isIdle } from './message.ts'
import { assertNoConflicts, extensionOf, flattenPlugins } from './plugin.ts'
import { toolError, toolRunner } from './tool.ts'
import { applyTurn, isModelAction, stop, turnOf } from './turn.ts'

/**
 * 其余字段是 pi-ai 的流选项，每次模型调用都会带上（temperature、maxTokens……）。
 * reasoning 是思考档位：不设就不思考；模型不支持的档位按这次请求的模型取最近的可用档位
 */
export interface AgentOptions extends Omit<SimpleStreamOptions, 'signal'> {
  model: Model<Api>
  system?: string
  tools?: AgentTool[]
  /** 前面的在内层，后面的在外层。可以嵌套 */
  plugins?: PluginList
}

/** 内部：Agent 在每次运行时实例化的入口，不从包中导出 */
export const instantiate: unique symbol = Symbol('instantiate')

/** 模型、工具、插件的组合。不含状态，可以复用；通过 createSession 运行 */
export interface Agent {
  readonly [instantiate]: (ctx: RunContext) => LLMAgent
}

/** 内部：属于一次运行、而不属于 agent 的东西 */
export interface RunContext {
  /** 取消当前这一步：中断或 abort 时触发 */
  signal: AbortSignal
  /** 这个步边界上可以送达的外部消息 */
  offer: (boundary: Boundary) => Message[]
  /** 这个步边界是否由中断产生 */
  interrupted: () => boolean
  /** 记录一次工具调用的耗时 */
  toolTime: (callId: string, ms: number) => void
}

/** 唯一的装配入口。工具或插件重名时抛 PluginConflictError，列出全部冲突 */
export function createAgent(options: AgentOptions): Agent {
  const { model, system = '', tools = [], plugins = [], ...streamOptions } = options

  const list = flattenPlugins(plugins)
  const allTools = [...new Set([...tools, ...list.flatMap(p => p.tools ?? [])])]
  assertNoConflicts(allTools, list)

  const parts: Parts = {
    model,
    systemPrompt: list.reduce((acc, p) => p.system?.(acc) ?? acc, system),
    tools: allTools,
    runTool: list.reduce(wrapToolRunner, toolRunner(allTools)),
    plugins: list,
    streamOptions,
  }
  const extensions = list.map(extensionOf)

  return {
    [instantiate]: ctx => extend(baseAgent(parts, ctx), ...extensions),
  }
}

/* ── 内部 ─────────────────────────────────────────────── */

interface Parts {
  model: Model<Api>
  systemPrompt: string
  tools: AgentTool[]
  runTool: ToolRunner
  plugins: AnyPlugin[]
  streamOptions: Omit<SimpleStreamOptions, 'signal'>
}

/**
 * 一步（RFC-0004 §4）：
 *   ① input   有要插入的消息 → 插入；没有且 agent 空闲 → 结束
 *   ② context 这次请求发给模型的消息
 *   ③ request 调用一次模型
 * 模型回合总是先写入状态，下一步才判断是否结束，所以最终回答也经过 update。
 */
function baseAgent(parts: Parts, ctx: RunContext): LLMAgent {
  const { model, systemPrompt, plugins, streamOptions } = parts
  const specs = parts.tools.map(({ name, description, parameters }) => ({
    name,
    description,
    parameters,
  }))

  const inputs = plugins.flatMap(p => (p.input ? [p.input] : []))
  const contexts = plugins.flatMap(p => (p.context ? [p.context] : []))
  const request = plugins.reduce(wrapRequest, callModel(ctx.signal))

  return {
    async *policy(state) {
      const boundary = { state, idle: isIdle(state) }
      const messages = await applyTransforms(inputs, ctx.offer(boundary), boundary)

      if (messages.length > 0) {
        return act({ kind: 'input', messages, idle: boundary.idle, interrupted: ctx.interrupted() })
      }
      if (boundary.idle) {
        return stop(state)
      }

      const view = await applyTransforms(contexts, state.messages, state)
      const msg = yield* request({
        model,
        systemPrompt,
        messages: view,
        tools: specs,
        options: streamOptions,
        state,
      })
      return act(msg)
    },

    env: action => (isModelAction(action) ? runTools(parts.runTool, action, ctx) : Promise.resolve([])),

    update: (state, action, results) => applyTurn(state, turnOf(action, results)),
  }
}

/** 最内层的 request：转发 pi-ai 的事件流；消费方提前退出时 abort 底层请求 */
function callModel(signal: AbortSignal): ModelCall {
  return async function* ({ model, systemPrompt, messages, tools, options }) {
    const ctl = new AbortController()
    const requestSignal = AbortSignal.any([signal, ctl.signal])
    const context = {
      systemPrompt: systemPrompt === '' ? undefined : systemPrompt,
      messages,
      tools,
    }
    const events = streamSimple(model, context, {
      ...supportedReasoning(model, options),
      signal: requestSignal,
    })

    let finished = false
    try {
      yield* events
      finished = true
    } finally {
      if (!finished) {
        ctl.abort()
      }
    }

    const msg = await events.result()
    if (msg.stopReason === 'error' || msg.stopReason === 'aborted') {
      throw new Error(`${model.provider}/${model.id} ${msg.stopReason}: ${msg.errorMessage}`)
    }
    return msg
  }
}

/**
 * 把 reasoning 换成这次请求的模型支持的档位：不支持的档位取最近的可用档位（优先更高），
 * 模型不能思考时去掉。放在最内层，所以 request 插件换了模型或改了档位也会经过它
 */
function supportedReasoning(model: Model<Api>, options: SimpleStreamOptions): SimpleStreamOptions {
  if (options.reasoning === undefined) {
    return options
  }

  const level = clampThinkingLevel(model, options.reasoning)
  return { ...options, reasoning: level === 'off' ? undefined : level }
}

/** 并行执行；中间件或工具抛出的异常都转为 isError 结果交还模型（I8） */
function runTools(runTool: ToolRunner, msg: AssistantMessage, ctx: RunContext): Promise<ToolResultMessage[]> {
  return Promise.all(
    callsOf(msg).map(async call => {
      const start = performance.now()
      try {
        return await runTool({ call, signal: ctx.signal })
      } catch (e) {
        return toolError(call, e)
      } finally {
        ctx.toolTime(call.id, performance.now() - start)
      }
    }),
  )
}

async function applyTransforms<T, C>(
  fns: Array<(value: T, context: C) => T | Promise<T>>,
  value: T,
  context: C,
): Promise<T> {
  let result = value
  for (const f of fns) {
    result = await f(result, context)
  }
  return result
}

function wrapToolRunner(next: ToolRunner, plugin: AnyPlugin): ToolRunner {
  const { tool } = plugin
  return tool ? ctx => tool(ctx, next) : next
}

function wrapRequest(next: ModelCall, plugin: AnyPlugin): ModelCall {
  const { request } = plugin
  return request ? req => request(req, next) : next
}
