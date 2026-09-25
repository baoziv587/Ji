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
 * The remaining fields are pi-ai stream options sent with every model call (temperature, maxTokens, ...).
 * `reasoning` is the thinking level: unset means no thinking; a level the request's model does not support is mapped
 * to the nearest one it does.
 */
export interface AgentOptions extends Omit<SimpleStreamOptions, 'signal'> {
  model: Model<Api>
  system?: string
  tools?: AgentTool[]
  /** Earlier plugins are nested inside later ones. May nest. */
  plugins?: PluginList
}

/** Not re-exported from index.ts: only a Run instantiates an Agent. */
export const instantiate: unique symbol = Symbol('instantiate')

/** Stateless and reusable; run it through createSession. */
export interface Agent {
  readonly [instantiate]: (ctx: RunContext) => LLMAgent
}

/** What belongs to one Run rather than to the Agent. */
export interface RunContext {
  /** Fires on interrupt or abort, cancelling the current step. */
  signal: AbortSignal
  /** Queued messages deliverable at this boundary. */
  offer: (boundary: Boundary) => Message[]
  interrupted: () => boolean
  toolTime: (callId: string, ms: number) => void
}

/** Throws PluginConflictError listing every duplicate tool or plugin name. */
export function createAgent(options: AgentOptions): Agent {
  /**
   * How the flattened plugin list [p1, p2] is compiled:
   *
   *   transforms, applied in list order            runs
   *     system    system -> p1 -> p2                once, here
   *     input     offered messages -> p1 -> p2      every step boundary
   *     context   state.messages -> p1 -> p2        every model request
   *
   *   middleware, later plugins wrap earlier ones (p2 sees the input first and the output last)
   *     policy^   p2( p1( baseAgent.policy ) )      every step
   *     env^      p2( p1( runTools ) )              every model turn with tool calls
   *     update^   p2( p1( applyTurn ) )             every step; each layer then runs its own state.reduce
   *     request   p2( p1( callModel ) )             every model call
   *     tool      p2( p1( toolRunner ) )            every tool call, inside runTools
   *
   *   ^ kernel middleware: extensionOf, then extend() on every instantiation
   */
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

interface Parts {
  model: Model<Api>
  systemPrompt: string
  tools: AgentTool[]
  runTool: ToolRunner
  plugins: AnyPlugin[]
  streamOptions: Omit<SimpleStreamOptions, 'signal'>
}

/**
 * One step (RFC-0004 §4); plugin policies wrap it and may return rewriteHistory / stop instead:
 *
 *   boundary = { state, idle }
 *   input transforms( ctx.offer(boundary) )
 *     |-- messages ----> act(InputAction) ------------------------+
 *     |                                                            |
 *     |-- none, busy --> context transforms( state.messages )     |
 *     |                  -> request -> deltas ... message          |
 *     |                  -> act(AssistantMessage)                  |
 *     |                  -> env: run its tool calls in parallel -->+
 *     |                                                            v
 *     |                              update: applyTurn -> next boundary
 *     |
 *     +-- none, idle --> stop(state) = done(last assistant message): the run ends
 *
 * A model turn is written before the next step checks for idle, so the final answer also goes through update.
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

// Innermost request. If the consumer stops iterating early, abort the underlying HTTP request too.
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
 * Maps an unsupported level to the nearest available one (preferring higher) and drops it for models that cannot
 * think. Called innermost so a request plugin that switches the model or level is still clamped.
 */
function supportedReasoning(model: Model<Api>, options: SimpleStreamOptions): SimpleStreamOptions {
  if (options.reasoning === undefined) {
    return options
  }

  const level = clampThinkingLevel(model, options.reasoning)
  return { ...options, reasoning: level === 'off' ? undefined : level }
}

// Anything thrown by tool middleware or the tool itself becomes an isError result for the model (I8).
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
