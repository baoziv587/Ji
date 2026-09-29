// Runs selected cases through the agent loop and writes what happened:
//
//   cases (streamed) x repeat --pool(concurrency)--> runCase
//     toScript -> replay (faux model, replay tools, probe, otel?, jsonl?) -> session.send(inputs)
//     for await (const e of run) -> ledger        observe -> probe's ledger, otel spans, jsonl events
//     verify(script, observed) -> failures -> one row in cases.jsonl
//   then: Parquet (optional), summary.json, report.md
//
// The whole suite runs under one meter (CPU, heap and RSS peaks, GC, event-loop delay); each case also records its
// own wall time, CPU and heap change, which are exact only with concurrency 1.

import type { Plugin, PluginList, Run, RunEvent, RunSummary } from '@ji.dev/llm'
import type { ResourceCost } from './metrics.ts'
import type { ReplayOptions } from './replay.ts'
import type { SuiteStats } from './report.ts'
import type { Sink, Table } from './sink.ts'
import type { SpanRecorder, SpanResource } from './spans.ts'
import type { Case, CaseFilter } from './testkit.ts'
import type { Outcome } from './verify.ts'
import { randomBytes } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { createSession, RunError, textOf } from '@ji.dev/llm'
import { jsonl } from '@ji.dev/plugin-jsonl'
import { otel } from '@ji.dev/plugin-otel'
import { openDb } from './dataset.ts'
import { createLedger } from './ledger.ts'
import { percentile, startMeter } from './metrics.ts'
import { replay } from './replay.ts'
import { pluginNames, renderReport, summarize } from './report.ts'
import { callsOf, toScript, turnsOf } from './script.ts'
import { jsonlSink, toParquet } from './sink.ts'
import { spanRecorder } from './spans.ts'
import { verify } from './verify.ts'

export interface SuiteOptions extends Omit<ReplayOptions, 'plugins'> {
  /** Names this replay run in every row; generated when left out. */
  id?: string
  /**
   * Plugins under test, placed inside the probe. The checks expect the recorded conversation back, so a plugin that
   * changes history or results on purpose will fail them; observers and pass-through middleware should not.
   */
  plugins?: PluginList
  /** Where the cases came from, for the report. */
  source: string
  filter: CaseFilter
  out: string
  format: 'jsonl' | 'parquet'
  concurrency: number
  /** Runs every case this many times. */
  repeat: number
  maxTurns?: number
  /** A case still running after this long is aborted and fails. */
  timeoutMs: number
  otel: boolean
  events: boolean
}

export interface CaseRow {
  replay_run_id: string
  case_id: string
  repeat: number
  task: string
  agent: string
  model: string
  reward: number
  ok: boolean
  failures: string[]
  error_kind: string | null
  model_turns: number
  synthetic_turns: number
  tool_calls: number
  inputs: number
  history_messages: number
  events: number
  text_chars: number
  input_tokens: number
  output_tokens: number
  wall_ms: number
  model_ms: number
  tool_ms: number
  first_token_ms_p50: number
  cpu_user_ms: number
  cpu_system_ms: number
  heap_delta_bytes: number
  events_per_sec: number
  concurrency: number
  started_at: string
}

export interface SuiteResult {
  id: string
  startedAt: string
  options: SuiteOptions
  rows: CaseRow[]
  cost: ResourceCost
  files: string[]
}

/** `cases` may be a stream (see streamCases): the pool pulls one case at a time, so the dataset is never all loaded. */
export async function runSuite(
  cases: Iterable<Case> | AsyncIterable<Case>,
  options: SuiteOptions,
  onCase?: (row: CaseRow, done: number) => void,
): Promise<SuiteResult & { stats: SuiteStats }> {
  const id = options.id ?? replayRunId()
  const startedAt = new Date().toISOString()
  mkdirSync(options.out, { recursive: true })

  const sinks = {
    cases: jsonlSink(join(options.out, 'cases.jsonl')),
    spans: options.otel ? jsonlSink(join(options.out, 'spans.jsonl')) : undefined,
    events: options.events ? jsonlSink(join(options.out, 'events.jsonl')) : undefined,
  }

  const rows: CaseRow[] = []

  const meter = startMeter()
  await pool(repeated(cases, options.repeat), options.concurrency, async ({ c, repeat }) => {
    const row = await runCase(c, repeat, id, options, sinks)
    rows.push(row)
    sinks.cases.write(row)
    onCase?.(row, rows.length)
    meter.sample()
    // A server gets I/O in between requests too; without this, timers and GC reports wait for the whole suite
    await new Promise(resolve => setImmediate(resolve))
  })
  const cost = await meter.stop()

  const files = await finish(options, sinks)
  const result: SuiteResult = { id, startedAt, options, rows, cost, files }

  const stats = summarize(result)
  const settings = { ...options, plugins: pluginNames(options.plugins ?? []) }
  writeFileSync(
    join(options.out, 'summary.json'),
    `${JSON.stringify({ id, startedAt, options: settings, cost, stats }, null, 2)}\n`,
  )
  writeFileSync(join(options.out, 'report.md'), renderReport(result, stats))
  return { ...result, stats, files: [...files, 'summary.json', 'report.md'] }
}

interface Sinks {
  cases: Sink
  spans?: Sink
  events?: Sink
}

async function runCase(c: Case, repeat: number, runId: string, options: SuiteOptions, sinks: Sinks): Promise<CaseRow> {
  const script = toScript(c, { maxTurns: options.maxTurns })
  const turns = turnsOf(script)
  const resource: SpanResource = {
    replay_run_id: runId,
    case_id: c.id,
    repeat,
    task: c.task,
    agent: c.agent,
    model: c.model,
  }

  let recorder: SpanRecorder | undefined
  const observers: Plugin[] = []
  if (sinks.spans !== undefined) {
    const spans = sinks.spans
    recorder = spanRecorder(resource, row => spans.write(row))
    observers.push(otel({ tracer: recorder.tracer, context: recorder.context }))
  }
  if (sinks.events !== undefined) {
    const events = sinks.events
    const tag = `{"case_id":${JSON.stringify(c.id)},"repeat":${repeat},`
    observers.push(jsonl(line => events.writeLine(tag + line.slice(1))))
  }

  const r = replay(script, c.model, { ...options, plugins: [options.plugins ?? [], observers] })
  const startedAt = new Date().toISOString()
  const cpu = process.cpuUsage()
  const heap = process.memoryUsage().heapUsed
  const start = performance.now()

  try {
    const session = createSession(r.agent, { maxSteps: turns.length + script.segments.length + 2 })
    const [first, ...rest] = script.segments
    const run = session.send(first.input)
    for (const segment of rest) {
      session.send(segment.input, { when: 'idle' })
    }

    const timer = setTimeout(() => run.abort(new Error(`timed out after ${options.timeoutMs} ms`)), options.timeoutMs)
    const ledger = createLedger()
    const firstTokens: number[] = []
    let summary: RunSummary | undefined

    try {
      for await (const e of run) {
        ledger.push(e)
        noteStep(e, firstTokens)
        if (e.type === 'run_end') {
          summary = e.summary
        }
      }
    } catch (error) {
      // A failed run rethrows its RunError to every reader; the outcome below reports it
      if (!(error instanceof RunError)) {
        throw error
      }
    } finally {
      clearTimeout(timer)
    }

    const outcome = await outcomeOf(run)
    const wallMs = performance.now() - start
    const used = process.cpuUsage(cpu)
    const seen = ledger.finish()
    const failures = verify(script, {
      outcome,
      run: seen,
      observed: r.probe.ledger.finish(),
      probe: r.probe,
      model: { ...r.faux(), violations: r.modelViolations },
      spans: recorder?.stats(),
    })

    return {
      ...resource,
      reward: c.reward,
      ok: failures.length === 0,
      failures,
      error_kind: outcome.ok ? null : outcome.error.kind,
      model_turns: turns.length,
      synthetic_turns: turns.filter(t => t.synthetic).length,
      tool_calls: callsOf(script).length,
      inputs: script.segments.length,
      history_messages: (outcome.ok ? outcome.state : outcome.error.state).messages.length,
      events: seen.events,
      text_chars: seen.text.length,
      input_tokens: summary?.usage.input ?? 0,
      output_tokens: summary?.usage.output ?? 0,
      wall_ms: wallMs,
      model_ms: summary?.modelMs ?? 0,
      tool_ms: summary?.toolMs ?? 0,
      first_token_ms_p50: percentile(firstTokens, 50),
      cpu_user_ms: used.user / 1000,
      cpu_system_ms: used.system / 1000,
      heap_delta_bytes: process.memoryUsage().heapUsed - heap,
      events_per_sec: wallMs === 0 ? 0 : (seen.events / wallMs) * 1000,
      concurrency: options.concurrency,
      started_at: startedAt,
    }
  } finally {
    r.dispose()
  }
}

function noteStep(e: RunEvent, firstTokens: number[]): void {
  if (e.type === 'step_end' && e.timing.firstTokenMs !== undefined) {
    firstTokens.push(e.timing.firstTokenMs)
  }
}

async function outcomeOf(run: Run): Promise<Outcome> {
  try {
    const [result, state, summary] = await Promise.all([run.result, run.state, run.summary])
    return { ok: true, result: textOf(result), state, summary }
  } catch (error) {
    if (error instanceof RunError) {
      return { ok: false, error }
    }
    throw error
  }
}

/** Closes the JSONL files and, for Parquet, converts them and removes the JSONL. Returns the files written. */
async function finish(options: SuiteOptions, sinks: Sinks): Promise<string[]> {
  const open = (Object.entries(sinks) as Array<[Table, Sink | undefined]>).filter(
    (entry): entry is [Table, Sink] => entry[1] !== undefined,
  )
  await Promise.all(open.map(([, sink]) => sink.close()))

  if (options.format === 'jsonl') {
    return open.map(([table]) => `${table}.jsonl`)
  }

  const db = await openDb()
  try {
    for (const [table, sink] of open) {
      await toParquet(db, table, sink.path, join(options.out, `${table}.parquet`))
      rmSync(sink.path)
    }
  } finally {
    db.close()
  }
  return open.map(([table]) => `${table}.parquet`)
}

async function* repeated(
  cases: Iterable<Case> | AsyncIterable<Case>,
  times: number,
): AsyncGenerator<{ c: Case; repeat: number }> {
  for await (const c of cases) {
    for (let repeat = 0; repeat < times; repeat++) {
      yield { c, repeat }
    }
  }
}

/**
 * Runs fn over items with at most `concurrency` in flight, taking them in order. The workers share one iterator; an
 * async generator queues concurrent next() calls, so each item goes to exactly one worker.
 */
async function pool<T>(items: AsyncIterable<T>, concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  const iterator = items[Symbol.asyncIterator]()
  const worker = async (): Promise<void> => {
    for (let next = await iterator.next(); !next.done; next = await iterator.next()) {
      await fn(next.value)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker))
}

/** Sortable and unique enough: 20260929T014501-3fa2. */
export function replayRunId(): string {
  const stamp = new Date()
    .toISOString()
    .replaceAll(/[-:]/g, '')
    .replace(/\.\d+Z$/, '')
  return `${stamp}-${randomBytes(2).toString('hex')}`
}
