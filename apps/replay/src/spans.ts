// A tracer for @ji.dev/plugin-otel that turns every finished span into a flat row, OTLP-shaped, ready for JSONL or
// Parquet:
//
//   otel({ tracer: rec.tracer, context: rec.context })  ->  onEnd({ trace_id, span_id, parent_span_id, name, ... })
//
// Times are Unix nanoseconds as strings, as OTLP/JSON writes int64. The resource fields (which replay run, which case)
// are columns of their own rather than a nested map, so DuckDB can filter and group on them directly.

import type { Attributes, ContextLike, SpanLike, TracerLike } from '@ji.dev/plugin-otel'
import { randomBytes } from 'node:crypto'
import { performance } from 'node:perf_hooks'

export interface SpanResource {
  replay_run_id: string
  case_id: string
  repeat: number
  task: string
  agent: string
  model: string
}

interface SpanEventRow {
  name: string
  time_unix_nano: string
  attributes: Attributes
}

export interface SpanRow extends SpanResource {
  trace_id: string
  span_id: string
  parent_span_id: string | null
  name: string
  kind: 'INTERNAL' | 'CLIENT'
  start_time_unix_nano: string
  end_time_unix_nano: string
  duration_ms: number
  status_code: 'UNSET' | 'ERROR'
  status_message: string | null
  attributes: Attributes
  events: SpanEventRow[]
}

export interface SpanStats {
  started: number
  ended: number
  /** Spans end() was called on more than once. */
  endedTwice: number
  /** Finished spans by gen_ai.operation.name, or by name for plugin spans. */
  byOperation: Record<string, number>
}

interface Ctx {
  span?: RecordingSpan
}

export interface SpanRecorder {
  tracer: TracerLike<Ctx, RecordingSpan>
  context: ContextLike<Ctx, RecordingSpan>
  stats: () => SpanStats
}

interface RecordingSpan extends SpanLike {
  readonly traceId: string
  readonly spanId: string
}

/** Root context: a real object, so the otel plugin nests children under the run's span. */
const ROOT: Ctx = {}

export function spanRecorder(resource: SpanResource, onEnd: (row: SpanRow) => void): SpanRecorder {
  const stats: SpanStats = { started: 0, ended: 0, endedTwice: 0, byOperation: {} }

  function startSpan(name: string, options?: { attributes?: Attributes }, ctx?: Ctx): RecordingSpan {
    stats.started++
    const parent = ctx?.span
    const traceId = parent?.traceId ?? hex(16)
    const spanId = hex(8)
    const start = nowNanos()
    const attributes: Attributes = { ...options?.attributes }
    const events: SpanEventRow[] = []
    let status: { code: number; message?: string } | undefined
    let ended = false

    return {
      traceId,
      spanId,
      setAttributes: more => Object.assign(attributes, more),
      addEvent: (eventName, eventAttributes = {}) => {
        events.push({ name: eventName, time_unix_nano: nowNanos().toString(), attributes: eventAttributes })
      },
      setStatus: s => {
        status = s
      },
      end: () => {
        if (ended) {
          stats.endedTwice++
          return
        }
        ended = true
        stats.ended++

        const operation = String(attributes['gen_ai.operation.name'] ?? name)
        stats.byOperation[operation] = (stats.byOperation[operation] ?? 0) + 1

        const end = nowNanos()
        onEnd({
          ...resource,
          trace_id: traceId,
          span_id: spanId,
          parent_span_id: parent?.spanId ?? null,
          name,
          kind: operation === 'chat' ? 'CLIENT' : 'INTERNAL',
          start_time_unix_nano: start.toString(),
          end_time_unix_nano: end.toString(),
          duration_ms: Number(end - start) / 1e6,
          status_code: status?.code === 2 ? 'ERROR' : 'UNSET',
          status_message: status?.message ?? null,
          attributes,
          events,
        })
      },
    }
  }

  return {
    tracer: { startSpan },
    context: { active: () => ROOT, setSpan: (_ctx, span) => ({ span }) },
    stats: () => structuredClone(stats),
  }
}

function nowNanos(): bigint {
  return BigInt(Math.round((performance.timeOrigin + performance.now()) * 1e6))
}

function hex(bytes: number): string {
  return randomBytes(bytes).toString('hex')
}
