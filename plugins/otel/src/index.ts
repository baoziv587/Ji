// @gaoxiang.ai/plugin-otel: OpenTelemetry traces and metrics from a run's events (RFC-0005 §4.4)
//
//   import { context, trace } from '@opentelemetry/api'
//   createAgent({ model, plugins: [otel({ tracer: trace.getTracer('agent'), context: { active: context.active, setSpan: trace.setSpan } })] })
//
//   invoke_agent                     first event of the run … run_end
//   ├─ chat deepseek-v4-flash        model_start … model_end
//   ├─ execute_tool calc             tool_start … tool_end        (parallel calls overlap)
//   ├─ compaction                    compaction:start … compaction:end   (any plugin's :start / :end pair)
//   └─ chat deepseek-v4-flash
//
// Only observe: it never changes the run and sees the same events whatever the plugin order. It depends on the shape
// of the OpenTelemetry API, not the package, so any tracer with startSpan fits. Names follow the GenAI semantic
// conventions (Development status at the time of writing).

import type { Plugin, RunEvent, RunInfo } from '@gaoxiang.ai/llm'
import { performance } from 'node:perf_hooks'
import { definePlugin } from '@gaoxiang.ai/llm'

export type AttributeValue = string | number | boolean | string[]
export type Attributes = Record<string, AttributeValue>

export interface SpanLike {
  setAttributes: (attributes: Attributes) => unknown
  addEvent: (name: string, attributes?: Attributes) => unknown
  setStatus: (status: { code: number; message?: string }) => unknown
  end: () => void
}

export interface TracerLike<Ctx, S extends SpanLike> {
  startSpan: (name: string, options?: { attributes?: Attributes }, context?: Ctx) => S
}

/** context.active and trace.setSpan from @opentelemetry/api; without them every span is a root span. */
export interface ContextLike<Ctx, S extends SpanLike> {
  active: () => Ctx
  setSpan: (context: Ctx, span: S) => Ctx
}

export interface MeterLike {
  createHistogram: (
    name: string,
    options?: { unit?: string; description?: string },
  ) => {
    record: (value: number, attributes?: Attributes) => unknown
  }
}

export interface OtelOptions<Ctx, S extends SpanLike> {
  tracer: TracerLike<Ctx, S>
  context?: ContextLike<Ctx, S>
  /** Records operation durations and token usage when given. */
  meter?: MeterLike
  /** Minimum time between two recorded updates of one tool call, in ms. Default 250. */
  updateInterval?: number
  /** Clock in milliseconds; replace it in tests. */
  now?: () => number
}

/** OpenTelemetry's SpanStatusCode.ERROR */
const ERROR = 2

interface RunSpans<Ctx, S extends SpanLike> {
  root: S
  /** Context the children start in: inside the root span. */
  inside: Ctx | undefined
  model: S | undefined
  tools: Map<string, S>
  /** Open `<plugin>:start` spans, by plugin prefix. */
  plugins: Map<string, S>
  lastUpdate: Map<string, number>
}

export function otel<Ctx, S extends SpanLike>(options: OtelOptions<Ctx, S>): Plugin {
  const { tracer, context, meter, updateInterval = 250, now = () => performance.now() } = options
  const runs = new Map<string, RunSpans<Ctx, S>>()
  const metrics = meter === undefined ? undefined : instruments(meter)

  function spansOf(run: RunInfo): RunSpans<Ctx, S> {
    let spans = runs.get(run.id)
    if (spans === undefined) {
      // observe runs in the run's async context, so the active span is the application's own request span
      const parent = context?.active()
      const root = tracer.startSpan(
        'invoke_agent',
        {
          attributes: {
            'gen_ai.operation.name': 'invoke_agent',
            'gen_ai.conversation.id': run.session,
            'pi.run.id': run.id,
          },
        },
        parent,
      )
      spans = {
        root,
        inside: context && parent !== undefined ? context.setSpan(parent, root) : undefined,
        model: undefined,
        tools: new Map(),
        plugins: new Map(),
        lastUpdate: new Map(),
      }
      runs.set(run.id, spans)
    }
    return spans
  }

  function child(spans: RunSpans<Ctx, S>, name: string, attributes: Attributes): S {
    return tracer.startSpan(name, { attributes }, spans.inside)
  }

  function onEvent(e: RunEvent, spans: RunSpans<Ctx, S>): void {
    switch (e.type) {
      case 'model_start':
        spans.model = child(spans, `chat ${e.model.id}`, {
          'gen_ai.operation.name': 'chat',
          'gen_ai.provider.name': e.model.provider,
          'gen_ai.request.model': e.model.id,
          'pi.thinking': e.thinking,
        })
        break
      case 'model_end':
        spans.model?.setAttributes({
          'gen_ai.response.model': e.message.model,
          'gen_ai.response.finish_reasons': [e.message.stopReason],
          'gen_ai.usage.input_tokens': e.message.usage.input,
          'gen_ai.usage.output_tokens': e.message.usage.output,
        })
        spans.model?.end()
        spans.model = undefined
        metrics?.model(e.message, e.ms)
        break
      case 'tool_start':
        spans.tools.set(
          e.call.id,
          child(spans, `execute_tool ${e.call.name}`, {
            'gen_ai.operation.name': 'execute_tool',
            'gen_ai.tool.name': e.call.name,
            'gen_ai.tool.call.id': e.call.id,
          }),
        )
        break
      case 'tool_update': {
        const time = now()
        const last = spans.lastUpdate.get(e.call.id)
        if (last === undefined || time - last >= updateInterval) {
          spans.lastUpdate.set(e.call.id, time)
          spans.tools.get(e.call.id)?.addEvent('tool_update', { 'pi.update': describe(e.data) })
        }
        break
      }
      case 'tool_end': {
        const span = spans.tools.get(e.call.id)
        if (e.result.isError) {
          span?.setAttributes({ 'error.type': 'tool_error' })
          span?.setStatus({ code: ERROR, message: textOf(e.result.content) })
        }
        span?.end()
        spans.tools.delete(e.call.id)
        spans.lastUpdate.delete(e.call.id)
        metrics?.tool(e.call.name, e.ms, e.result.isError)
        break
      }
      case 'step_end':
        spans.root.addEvent('step_end', { 'pi.step': e.t, 'pi.turn.kind': e.turn.kind })
        break
      case 'step_cancelled':
        endChildren(spans, `step ${e.reason}`)
        break
      case 'run_end':
        endChildren(spans, 'run ended')
        if (e.outcome === 'failed') {
          spans.root.setAttributes({ 'error.type': e.error.kind })
          spans.root.setStatus({ code: ERROR, message: e.error.message })
        }
        spans.root.end()
        break
      default:
        onPluginEvent(e.type, spans)
    }
  }

  /** `<plugin>:start` / `<plugin>:end` become a span; any other plugin event is a span event on the run. */
  function onPluginEvent(type: string, spans: RunSpans<Ctx, S>): void {
    const colon = type.lastIndexOf(':')
    if (colon === -1) {
      return
    }

    const [plugin, phase] = [type.slice(0, colon), type.slice(colon + 1)]
    if (phase === 'start') {
      spans.plugins.get(plugin)?.end()
      spans.plugins.set(plugin, child(spans, plugin, { 'pi.plugin': plugin }))
    } else if (phase === 'end') {
      spans.plugins.get(plugin)?.end()
      spans.plugins.delete(plugin)
    } else {
      spans.root.addEvent(type)
    }
  }

  return definePlugin({
    name: 'otel',
    observe: (e, run) => {
      const spans = spansOf(run)
      onEvent(e, spans)
      if (e.type === 'run_end') {
        runs.delete(run.id)
      }
    },
  })
}

/** Spans still open when their step is cancelled or the run ends: marked as cancelled and ended. */
function endChildren<S extends SpanLike>(spans: RunSpans<unknown, S>, reason: string): void {
  const open = [spans.model, ...spans.tools.values(), ...spans.plugins.values()]
  for (const span of open) {
    span?.setAttributes({ 'error.type': 'cancelled' })
    span?.setStatus({ code: ERROR, message: reason })
    span?.end()
  }
  spans.model = undefined
  spans.tools.clear()
  spans.plugins.clear()
  spans.lastUpdate.clear()
}

function instruments(meter: MeterLike): {
  model: (message: { model: string; usage: { input: number; output: number } }, ms: number) => void
  tool: (name: string, ms: number, isError: boolean) => void
} {
  const duration = meter.createHistogram('gen_ai.client.operation.duration', {
    unit: 's',
    description: 'GenAI operation duration',
  })
  const tokens = meter.createHistogram('gen_ai.client.token.usage', {
    unit: '{token}',
    description: 'Tokens used per model call',
  })

  return {
    model: (message, ms) => {
      const base = { 'gen_ai.operation.name': 'chat', 'gen_ai.request.model': message.model }
      duration.record(ms / 1000, base)
      tokens.record(message.usage.input, { ...base, 'gen_ai.token.type': 'input' })
      tokens.record(message.usage.output, { ...base, 'gen_ai.token.type': 'output' })
    },
    tool: (name, ms, isError) => {
      duration.record(ms / 1000, {
        'gen_ai.operation.name': 'execute_tool',
        'gen_ai.tool.name': name,
        ...(isError ? { 'error.type': 'tool_error' } : {}),
      })
    },
  }
}

/** A short, readable form of a tool update of any type. */
function describe(data: unknown): string {
  const text = typeof data === 'string' ? data : (JSON.stringify(data) ?? String(data))
  return text.length > 256 ? `${text.slice(0, 255)}…` : text
}

function textOf(content: ReadonlyArray<{ type: string; text?: string }>): string {
  return content.map(c => c.text ?? '').join('')
}
