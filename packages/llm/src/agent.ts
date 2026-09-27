import type { Stream } from '@gaoxiang.ai/kernel'
import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Message,
  Model,
  ToolCall,
  ToolResultMessage,
} from '@mariozechner/pi-ai'
import type { ModelInfo } from './models.ts'
import type { AnyPlugin, PluginList } from './plugin.ts'
import type {
  AgentTool,
  Boundary,
  LLMAgent,
  ModelCall,
  Payload,
  RunEvent,
  RunInfo,
  StreamOptions,
  ThinkingLevel,
  ToolRunner,
} from './types.ts'
import { performance } from 'node:perf_hooks'
import { act, extend, merge } from '@gaoxiang.ai/kernel'
import { clampThinkingLevel, streamSimple } from '@mariozechner/pi-ai'
import { ModelCallError } from './errors.ts'
import { callsOf, isIdle } from './message.ts'
import { findModel, modelInfo, UnsupportedThinkingError } from './models.ts'
import { assertNoConflicts, extensionOf, flattenPlugins } from './plugin.ts'
import { toolError, toolRunner } from './tool.ts'
import { applyTurn, isModelAction, stop, turnOf } from './turn.ts'

/** The remaining fields are pi-ai stream options sent with every model call (temperature, maxTokens, ...). */
export interface AgentOptions extends StreamOptions {
  /** 'provider/id' from pi-ai's catalog, or a pi-ai Model for anything else (custom baseUrl, faux provider). */
  model: string | Model<Api>
  /**
   * Must be one of agent.model.thinkingLevels, or createAgent throws. Default: 'off', or the lowest level for a model
   * that always thinks.
   */
  thinking?: ThinkingLevel
  system?: string
  tools?: AgentTool[]
  /** Earlier plugins are nested inside later ones. May nest. */
  plugins?: PluginList
}

/** Not re-exported from index.ts: only a Run instantiates an Agent. */
export const instantiate: unique symbol = Symbol('instantiate')
/** Not re-exported from index.ts: only a Run feeds events to the plugins' observe. */
export const observe: unique symbol = Symbol('observe')

/** Stateless and immutable; run it through createSession. */
export interface Agent {
  readonly model: ModelInfo
  readonly thinking: ThinkingLevel
  /** A new Agent with these options replaced, checked like createAgent; this one is unchanged. */
  with: (patch: Partial<AgentOptions>) => Agent
  readonly [instantiate]: (ctx: RunContext) => LLMAgent
  /** Every plugin's observe, isolated from each other and from the run. */
  readonly [observe]: (e: RunEvent, run: RunInfo) => void
}

/** What belongs to one Run rather than to the Agent. */
export interface RunContext {
  /** Fires on interrupt or abort, cancelling the current step. */
  signal: AbortSignal
  /** Queued messages deliverable at this boundary. */
  offer: (boundary: Boundary) => Message[]
  interrupted: () => boolean
}

/**
 * Throws UnknownModelError for a model spec pi-ai does not know, UnsupportedThinkingError for a thinking level the
 * model does not accept, and PluginConflictError listing every duplicate tool or plugin name.
 */
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
   *     turn^     p2( p1( baseAgent.policy ) )      every step
   *     env^      p2( p1( runTools ) )              every model turn with tool calls
   *     update^   p2( p1( applyTurn ) )             every step; each layer then runs its own state.reduce
   *     request   p2( p1( callModel ) )             every model call
   *     tool      p2( p1( toolRunner ) )            every tool call, inside runTools
   *
   *   observers, not nested: each gets the Run's events directly, whatever the order
   *     observe   p1, p2                            every event
   *
   *   ^ kernel middleware: extensionOf, then extend() on every instantiation
   */
  const { model: spec, thinking: chosen, system = '', tools = [], plugins = [], ...streamOptions } = options

  const model = typeof spec === 'string' ? findModel(spec) : modelInfo(spec)
  const thinking = chosen ?? defaultThinking(model)
  if (!model.thinkingLevels.includes(thinking)) {
    throw new UnsupportedThinkingError(model, thinking)
  }

  const list = flattenPlugins(plugins)
  const allTools = [...new Set([...tools, ...list.flatMap(p => p.tools ?? [])])]
  assertNoConflicts(allTools, list)

  const parts: Parts = {
    model,
    thinking,
    systemPrompt: list.reduce((acc, p) => p.system?.(acc) ?? acc, system),
    tools: allTools,
    runTool: list.reduce(wrapToolRunner, toolRunner(allTools)),
    plugins: list,
    streamOptions,
  }
  const extensions = list.map(extensionOf)

  return {
    model,
    thinking,
    with: patch => createAgent({ ...options, ...patch }),
    [instantiate]: ctx => extend(baseAgent(parts, ctx), ...extensions),
    [observe]: isolated(list),
  }
}

/** Off when the model allows it; some models always think, and then their lightest level is the default. */
function defaultThinking(model: ModelInfo): ThinkingLevel {
  return model.thinkingLevels.includes('off') ? 'off' : model.thinkingLevels[0]
}

interface Parts {
  model: Model<Api>
  thinking: ThinkingLevel
  systemPrompt: string
  tools: AgentTool[]
  runTool: ToolRunner
  plugins: AnyPlugin[]
  streamOptions: StreamOptions
}

/**
 * One step (RFC-0004 §4); plugin policies wrap it and may return rewriteHistory / stop instead:
 *
 *   boundary = { state, idle }
 *   input transforms( ctx.offer(boundary) )
 *     |-- messages ----> act(InputAction) ------------------------+
 *     |                                                            |
 *     |-- none, busy --> context transforms( state.messages )     |
 *     |                  -> request -> events ... message          |
 *     |                  -> act(AssistantMessage)                  |
 *     |                  -> env: its tool calls, merged ---------->+
 *     |                                                            v
 *     |                              update: applyTurn -> next boundary
 *     |
 *     +-- none, idle --> stop(state) = done(last assistant message): the run ends
 *
 * A model turn is written before the next step checks for idle, so the final answer also goes through update.
 */
function baseAgent(parts: Parts, ctx: RunContext): LLMAgent {
  const { model, thinking, systemPrompt, plugins, streamOptions } = parts
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
        thinking,
        options: streamOptions,
        state,
      })
      return act(msg)
    },

    env: action => (isModelAction(action) ? runTools(parts.runTool, action, ctx.signal) : noResults()),

    update: (state, action, results) => applyTurn(state, turnOf(action, results)),
  }
}

/**
 * Innermost request: model_start, the model's thinking / text / finished tool calls, model_end.
 * If the consumer stops early, the underlying HTTP request is aborted too.
 */
function callModel(signal: AbortSignal): ModelCall {
  return async function* ({ model, systemPrompt, messages, tools, thinking, options }) {
    // Clamped here, innermost, so a request plugin that switches the model or level is still reported truthfully
    const level = clampThinkingLevel(model, thinking)
    yield { type: 'model_start', model: { provider: model.provider, id: model.id }, thinking: level }

    const start = performance.now()
    const ctl = new AbortController()
    const context = {
      systemPrompt: systemPrompt === '' ? undefined : systemPrompt,
      messages,
      tools,
    }
    const events = streamSimple(model, context, {
      ...options,
      reasoning: level === 'off' ? undefined : level,
      signal: AbortSignal.any([signal, ctl.signal]),
    })

    let finished = false
    try {
      for await (const e of events) {
        const payload = payloadOf(e)
        if (payload !== undefined) {
          yield payload
        }
      }
      finished = true
    } finally {
      if (!finished) {
        ctl.abort()
      }
    }

    const msg = await events.result()
    if (msg.stopReason === 'error' || msg.stopReason === 'aborted') {
      throw new ModelCallError(`${model.provider}/${model.id} ${msg.stopReason}: ${msg.errorMessage}`)
    }
    yield { type: 'model_end', message: msg, ms: performance.now() - start }
    return msg
  }
}

/** The pi-ai events worth an event of their own; the rest (starts, ends, argument deltas) stay inside callModel. */
function payloadOf(e: AssistantMessageEvent): Payload | undefined {
  switch (e.type) {
    case 'thinking_delta':
      return { type: 'thinking', delta: e.delta }
    case 'text_delta':
      return { type: 'text', delta: e.delta }
    case 'toolcall_end':
      return { type: 'tool_call', call: e.toolCall }
    default:
      return undefined
  }
}

/** The calls of one model turn run at once; their events interleave, their results keep the call order. */
function runTools(
  runTool: ToolRunner,
  msg: AssistantMessage,
  signal: AbortSignal,
): Stream<Payload, ToolResultMessage[]> {
  return merge(callsOf(msg).map(call => runCall(runTool, call, signal)))
}

/**
 * Outside the whole tool middleware chain, so even an intercepted call has its tool_start and tool_end.
 * Anything thrown by tool middleware or the tool itself becomes an isError result for the model (I8).
 */
async function* runCall(runTool: ToolRunner, call: ToolCall, signal: AbortSignal): Stream<Payload, ToolResultMessage> {
  yield { type: 'tool_start', call }

  const start = performance.now()
  let result: ToolResultMessage
  try {
    result = yield* runTool({ call, signal })
  } catch (e) {
    result = toolError(call, e)
  }

  yield { type: 'tool_end', call, result, ms: performance.now() - start }
  return result
}

async function* noResults(): Stream<never, ToolResultMessage[]> {
  return []
}

/** One observer that calls every plugin's observe in order; a throwing observe is reported and skipped. */
function isolated(plugins: AnyPlugin[]): (e: RunEvent, run: RunInfo) => void {
  const observers = plugins.flatMap(p => (p.observe ? [{ name: p.name, observe: p.observe }] : []))

  return (e, run) => {
    for (const { name, observe } of observers) {
      try {
        observe(e, run)
      } catch (error) {
        warn(
          `observe of plugin "${name}" threw on ${e.type}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }
}

interface NodeProcess {
  emitWarning?: (message: string, type: string) => void
}

/** process.emitWarning in Node; console.error where there is no process (browsers). */
function warn(message: string): void {
  const node = Reflect.get(globalThis, 'process') as NodeProcess | undefined
  if (typeof node?.emitWarning === 'function') {
    node.emitWarning(message, 'ObserveWarning')
  } else {
    console.error(message)
  }
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
