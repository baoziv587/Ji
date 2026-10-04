import type { Stream } from '@ji.dev/kernel'
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
import type { AnyPlugin, CallOptions, CompleteRequest, HookContexts, PluginList } from './plugin.ts'
import type {
  AgentState,
  AgentTool,
  Boundary,
  LLMAgent,
  ModelRequest,
  Payload,
  RunEvent,
  RunInfo,
  StreamOptions,
  ThinkingLevel,
  ToolRunner,
} from './types.ts'
import { performance } from 'node:perf_hooks'
import { act, extend, merge } from '@ji.dev/kernel'
import { errorMessage, isDevEnv, isThenable, warn } from '@ji.dev/utils'
import { clampThinkingLevel, streamSimple } from '@mariozechner/pi-ai'
import { ModelCallError } from './errors.ts'
import { callsOf, isIdle } from './message.ts'
import { findModel, modelInfo, UnsupportedThinkingError } from './models.ts'
import { assertNoConflicts, extensionOf, pluginsOf } from './plugin.ts'
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
  /** Read top to bottom, outside in: earlier plugins see a middleware's input first. May nest; each object counts once. */
  plugins?: PluginList
  /**
   * Development checks (RFC-0006 §8): committed state is frozen, so writing to it throws where it happens, and every
   * state.reduce runs twice to catch one that is not pure. Default: on when NODE_ENV is development or test.
   */
  checkDeterminism?: boolean
}

/** Not re-exported from index.ts: only a Run instantiates an Agent. */
export const instantiate: unique symbol = Symbol('instantiate')
/** Not re-exported from index.ts: only a Run feeds events to the plugins' observe. */
export const observe: unique symbol = Symbol('observe')
/** Not re-exported from index.ts: tells a Run to freeze the state it commits. */
export const checks: unique symbol = Symbol('checks')

/** Stateless and immutable; run it through createSession. */
export interface Agent {
  readonly model: ModelInfo
  readonly thinking: ThinkingLevel
  /** A new Agent with these options replaced, checked like createAgent; this one is unchanged. */
  with: (patch: Partial<AgentOptions>) => Agent
  readonly [instantiate]: (ctx: RunContext) => LLMAgent
  /** Every plugin's observe, isolated from each other and from the run. */
  readonly [observe]: (e: RunEvent, run: RunInfo) => void
  readonly [checks]: boolean
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
   * How the plugin list is compiled (RFC-0006 §6, appendix B.1). Nested presets are flattened and each object kept
   * once, where it first appears; say that leaves [p1, p2]:
   *
   *   transforms, applied in list order            runs
   *     system    system -> p1 -> p2                once, here
   *     input     offered messages -> p1 -> p2      every step boundary
   *
   *   middleware, earlier plugins wrap later ones (p1 sees the input first and the output last)
   *     decide^     p1( p2( baseAgent.policy ) )    every step
   *     toolCalls^  p1( p2( runTools ) )            every model turn with tool calls
   *     record^     p1( p2( applyTurn ) )           every step; each layer then runs its own state.reduce
   *     request     p1( p2( callModel ) )           every model call, ctx.complete's included
   *     toolCall    p1( p2( toolRunner ) )          every tool call, inside runTools
   *
   *   observers, not nested: each gets the Run's events directly, in list order
   *     observe   p1, p2                            every event
   *
   *   ^ kernel middleware: extensionOf, then extend() with the list reversed, since extend puts later ones outside
   */
  const {
    model: spec,
    thinking: chosen,
    system = '',
    tools = [],
    plugins = [],
    checkDeterminism = isDevEnv(),
    ...streamOptions
  } = options

  const model = typeof spec === 'string' ? findModel(spec) : modelInfo(spec)
  const thinking = chosen ?? defaultThinking(model)
  if (!model.thinkingLevels.includes(thinking)) {
    throw new UnsupportedThinkingError(model, thinking)
  }

  const list = pluginsOf(plugins)
  const allTools = [...new Set([...tools, ...list.flatMap(p => p.tools ?? [])])]
  assertNoConflicts(allTools, list)

  const parts: Parts = {
    model,
    thinking,
    systemPrompt: list.reduce((acc, p) => p.system?.(acc) ?? acc, system),
    tools: allTools,
    plugins: list,
    streamOptions,
    checkDeterminism,
  }

  return {
    model,
    thinking,
    with: patch => createAgent({ ...options, ...patch }),
    [instantiate]: ctx => compile(parts, ctx),
    [observe]: isolated(list),
    [checks]: checkDeterminism,
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
  plugins: AnyPlugin[]
  streamOptions: StreamOptions
  checkDeterminism: boolean
}

/** One model call as the request chain sees it: the main model's gets the step's signal and no `by`. */
interface CallScope {
  signal: AbortSignal
  by?: string
}

/** The request chain inside: every layer passes the call's scope on, so ctx.by and the events agree. */
type RequestChain = (req: ModelRequest, call: CallScope) => Stream<Payload, AssistantMessage>

/** The chains baseAgent calls into, already wrapped by every plugin. */
interface Chains {
  request: RequestChain
  runTool: ToolRunner
  contexts: HookContexts
}

/**
 * Builds the agent one Run segment runs. The state a step starts from is its snapshot: every hook of that step gets
 * a ctx made from it, so they all see the same state and own, whichever layer they sit in.
 */
function compile(parts: Parts, rctx: RunContext): LLMAgent {
  const { plugins } = parts
  // Wrapping innermost first leaves the first plugin outermost
  const inward = plugins.toReversed()
  let snapshot: AgentState | undefined

  const contexts: HookContexts = {
    of: plugin => {
      const state = snapshot!
      return { state, own: plugin.select(state), signal: rctx.signal }
    },
    decide: plugin => ({
      ...contexts.of(plugin),
      complete: (req, options) => complete(plugin, req, options),
    }),
  }

  const request = inward.reduce<RequestChain>((next, p) => wrapRequest(next, p, contexts), callModel)
  const runTool = inward.reduce((next, p) => wrapToolCall(next, p, contexts), toolRunner(parts.tools, rctx.signal))

  function complete(plugin: AnyPlugin, req: CompleteRequest, options?: CallOptions): Stream<Payload, AssistantMessage> {
    const signal = options?.signal ? AbortSignal.any([rctx.signal, options.signal]) : rctx.signal

    // Field by field, so an option passed as undefined still gets its default
    const full: ModelRequest = {
      model: req.model ?? parts.model,
      systemPrompt: req.systemPrompt ?? '',
      messages: req.messages,
      tools: req.tools ?? [],
      thinking: req.thinking ?? parts.thinking,
      options: req.options ?? parts.streamOptions,
      state: snapshot!,
    }
    return withoutContent(request(full, { signal, by: plugin.name }))
  }

  const base = baseAgent(parts, rctx, { request, runTool, contexts })
  const agent = extend(base, ...inward.map(p => extensionOf(p, contexts, parts.checkDeterminism)))

  return {
    ...agent,
    policy: state => {
      snapshot = state
      return agent.policy(state)
    },
  }
}

/**
 * One step (RFC-0004 §4); plugin decide middleware wraps it and may return rewriteHistory / stop instead:
 *
 *   boundary = { state, idle }
 *   input transforms( ctx.offer(boundary) )
 *     |-- messages ----> act(InputAction) ------------------------+
 *     |                                                            |
 *     |-- none, busy --> request( state.messages ) -> events ...   |
 *     |                  ... message                               |
 *     |                  -> act(AssistantMessage)                  |
 *     |                  -> toolCalls: its tool calls, merged ---->+
 *     |                                                            v
 *     |                              record: applyTurn -> next boundary
 *     |
 *     +-- none, idle --> stop(state) = done(last assistant message): the run ends
 *
 * A model turn is written before the next step checks for idle, so the final answer also goes through record.
 */
function baseAgent(parts: Parts, rctx: RunContext, chains: Chains): LLMAgent {
  const { model, thinking, systemPrompt, plugins, streamOptions } = parts
  const { request, runTool, contexts } = chains
  const specs = parts.tools.map(({ name, description, parameters }) => ({
    name,
    description,
    parameters,
  }))

  const inputs = plugins.flatMap(plugin => (plugin.input ? [{ plugin, run: plugin.input }] : []))

  return {
    async *policy(state) {
      const idle = isIdle(state)
      const offered = rctx.offer({ state, idle })
      const messages = await applyTransforms(inputs, offered, plugin => ({ ...contexts.of(plugin), idle }))

      if (messages.length > 0) {
        return act({ kind: 'input', messages, idle, interrupted: rctx.interrupted() })
      }
      if (idle) {
        return stop(state)
      }

      // The input transforms may have awaited: a step cancelled meanwhile starts no request
      rctx.signal.throwIfAborted()

      const req = {
        model,
        systemPrompt,
        messages: state.messages,
        tools: specs,
        thinking,
        options: streamOptions,
        state,
      }
      const msg = yield* request(req, { signal: rctx.signal })
      return act(msg)
    },

    env: action => (isModelAction(action) ? runTools(runTool, action) : noResults()),

    update: (state, action, results) => applyTurn(state, turnOf(action, results)),
  }
}

/**
 * Innermost request: model_start, the model's thinking / text / finished tool calls, then model_end, or model_error
 * followed by a ModelCallError. The call's `by` goes on all three. If the consumer stops early, the underlying HTTP
 * request is aborted too.
 */
async function* callModel(req: ModelRequest, { signal, by }: CallScope): Stream<Payload, AssistantMessage> {
  const { model, systemPrompt, messages, tools, thinking, options } = req
  const origin = by === undefined ? {} : { by }

  // Clamped here, innermost, so a request plugin that switches the model or level is still reported truthfully
  const level = clampThinkingLevel(model, thinking)
  yield { type: 'model_start', model: { provider: model.provider, id: model.id }, thinking: level, ...origin }

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
  const ms = performance.now() - start

  if (msg.stopReason === 'error' || msg.stopReason === 'aborted') {
    const error = new ModelCallError(`${model.provider}/${model.id} ${msg.stopReason}: ${msg.errorMessage}`)
    yield { type: 'model_error', error, usage: msg.usage, ms, ...origin }
    throw error
  }

  yield { type: 'model_end', message: msg, ms, ...origin }
  return msg
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

/**
 * What a plugin's ctx.complete lets through: its model events and any plugin events, not its thinking, text or tool
 * calls, so r.text stays the main model's answer (RFC-0006 §5.2). The result is kept; cancelling closes the call.
 * A forwarded event's reply goes back to the call; a dropped one gets none (I15).
 */
async function* withoutContent<T>(stream: Stream<Payload, T>): Stream<Payload, T> {
  try {
    let next = await stream.next()
    while (!next.done) {
      const e = next.value
      const reply = isContent(e) ? undefined : yield e
      next = await stream.next(reply)
    }
    return next.value
  } finally {
    await stream.return(undefined as never)
  }
}

function isContent(e: Payload): boolean {
  return e.type === 'thinking' || e.type === 'text' || e.type === 'tool_call'
}

/** The calls of one model turn run at once; their events interleave, their results keep the call order. */
function runTools(runTool: ToolRunner, msg: AssistantMessage): Stream<Payload, ToolResultMessage[]> {
  return merge(callsOf(msg).map(call => runCall(runTool, call)))
}

/**
 * Outside the whole toolCall middleware chain, so even an intercepted call has its tool_start and tool_end.
 * Anything thrown by toolCall middleware or the tool itself becomes an isError result for the model (I8).
 */
async function* runCall(runTool: ToolRunner, call: ToolCall): Stream<Payload, ToolResultMessage> {
  yield { type: 'tool_start', call }

  const start = performance.now()
  let result: ToolResultMessage
  try {
    result = yield* runTool(call)
  } catch (e) {
    result = toolError(call, e)
  }

  yield { type: 'tool_end', call, result, ms: performance.now() - start }
  return result
}

async function* noResults(): Stream<never, ToolResultMessage[]> {
  return []
}

/**
 * One observer that calls every plugin's observe in order. A throwing observe is reported and skipped. One that
 * returns a promise is reported once, since nothing awaits it, and its rejection is caught and reported too.
 * Reports go out as process warnings, never as events, so an observer never sees its own failures.
 */
function isolated(plugins: AnyPlugin[]): (e: RunEvent, run: RunInfo) => void {
  const observers = plugins.flatMap(p => (p.observe ? [{ name: p.name, observe: p.observe }] : []))
  const returnedPromise = new Set<string>()

  return (e, run) => {
    for (const { name, observe } of observers) {
      try {
        const returned: unknown = observe(e, run)
        if (isThenable(returned)) {
          reportPromise(name, e.type, returned, returnedPromise)
        }
      } catch (error) {
        warn(`observe of plugin "${name}" threw on ${e.type}: ${errorMessage(error)}`, 'ObserveWarning')
      }
    }
  }
}

function reportPromise(name: string, type: string, returned: PromiseLike<unknown>, reported: Set<string>): void {
  if (!reported.has(name)) {
    reported.add(name)
    warn(
      `observe of plugin "${name}" returned a promise; observe is synchronous and the promise is not awaited`,
      'ObserveWarning',
    )
  }

  Promise.resolve(returned).catch((error: unknown) => {
    warn(`observe of plugin "${name}" rejected on ${type}: ${errorMessage(error)}`, 'ObserveWarning')
  })
}

/** Each plugin's transform in list order, each with its own ctx. */
async function applyTransforms<T, C>(
  transforms: Array<{ plugin: AnyPlugin; run: (value: T, ctx: C) => T | Promise<T> }>,
  value: T,
  ctxOf: (plugin: AnyPlugin) => C,
): Promise<T> {
  let result = value
  for (const { plugin, run } of transforms) {
    result = await run(result, ctxOf(plugin))
  }
  return result
}

function wrapRequest(next: RequestChain, plugin: AnyPlugin, contexts: HookContexts): RequestChain {
  const { request } = plugin
  if (!request) {
    return next
  }

  return (req, call) => request(req, r => next(r, call), { ...contexts.of(plugin), signal: call.signal, by: call.by })
}

function wrapToolCall(next: ToolRunner, plugin: AnyPlugin, contexts: HookContexts): ToolRunner {
  const { toolCall } = plugin
  return toolCall ? call => toolCall(call, next, contexts.of(plugin)) : next
}
