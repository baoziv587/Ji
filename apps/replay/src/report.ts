// A replay run in numbers (summarize) and as a Markdown page (renderReport). Both are pure over the SuiteResult.

import type { PluginList } from '@ji.dev/llm'
import type { CaseRow, SuiteResult } from './runner.ts'
import { join } from 'node:path'
import { percentile } from './metrics.ts'

interface Spread {
  p50: number
  p90: number
  p99: number
  max: number
}

interface AgentStats {
  agent: string
  cases: number
  passed: number
  modelTurns: number
  wallMs: Spread
}

export interface SuiteStats {
  cases: number
  passed: number
  failed: number
  modelTurns: number
  toolCalls: number
  events: number
  textChars: number
  throughput: { casesPerSec: number; turnsPerSec: number; toolCallsPerSec: number; eventsPerSec: number }
  caseWallMs: Spread
  firstTokenMs: Spread
  /** Process CPU spent per model turn and per event, over the whole suite. */
  cpuPerTurnUs: number
  cpuPerEventUs: number
  /** Failures grouped by what failed: the text before the first ':', numbers masked. */
  failureKinds: Record<string, number>
  byAgent: AgentStats[]
}

export function summarize({ rows, cost }: Pick<SuiteResult, 'rows' | 'cost'>): SuiteStats {
  const sum = (f: (r: CaseRow) => number): number => rows.reduce((acc, r) => acc + f(r), 0)
  const perSec = (n: number): number => (cost.wallMs === 0 ? 0 : (n / cost.wallMs) * 1000)
  const passed = rows.filter(r => r.ok).length
  const modelTurns = sum(r => r.model_turns)
  const events = sum(r => r.events)
  const toolCalls = sum(r => r.tool_calls)
  const cpuUs = (cost.cpuUserMs + cost.cpuSystemMs) * 1000

  const failureKinds: Record<string, number> = {}
  for (const failure of rows.flatMap(r => r.failures)) {
    const kind = kindOf(failure)
    failureKinds[kind] = (failureKinds[kind] ?? 0) + 1
  }

  const agents = [...new Set(rows.map(r => r.agent))].toSorted()
  const byAgent = agents.map(agent => {
    const mine = rows.filter(r => r.agent === agent)
    return {
      agent,
      cases: mine.length,
      passed: mine.filter(r => r.ok).length,
      modelTurns: mine.reduce((acc, r) => acc + r.model_turns, 0),
      wallMs: spread(mine.map(r => r.wall_ms)),
    }
  })

  return {
    cases: rows.length,
    passed,
    failed: rows.length - passed,
    modelTurns,
    toolCalls,
    events,
    textChars: sum(r => r.text_chars),
    throughput: {
      casesPerSec: perSec(rows.length),
      turnsPerSec: perSec(modelTurns),
      toolCallsPerSec: perSec(toolCalls),
      eventsPerSec: perSec(events),
    },
    caseWallMs: spread(rows.map(r => r.wall_ms)),
    firstTokenMs: spread(rows.map(r => r.first_token_ms_p50)),
    cpuPerTurnUs: modelTurns === 0 ? 0 : cpuUs / modelTurns,
    cpuPerEventUs: events === 0 ? 0 : cpuUs / events,
    failureKinds,
    byAgent,
  }
}

export function renderReport(result: SuiteResult, stats: SuiteStats): string {
  const { id, options: o, cost, rows } = result
  const verdict =
    stats.failed === 0
      ? `✅ ${stats.passed}/${stats.cases} cases passed`
      : `❌ ${stats.failed}/${stats.cases} cases failed`
  const failed = rows.filter(r => !r.ok)
  const slowest = rows.toSorted((a, b) => b.wall_ms - a.wall_ms).slice(0, 5)
  const ext = o.format === 'parquet' ? 'parquet' : 'jsonl'

  return `# ji replay · ${id}

${verdict} · ${stats.modelTurns} model turns · ${stats.toolCalls} tool calls · ${stats.events} events

| setting | value |
| --- | --- |
| source | \`${o.source}\` |
| filter | \`${JSON.stringify(o.filter)}\` |
| cases × repeat | ${stats.cases / o.repeat} × ${o.repeat} |
| concurrency | ${o.concurrency} |
| max turns per case | ${o.maxTurns ?? 'all'} |
| faux tokens/s | ${o.tokensPerSecond === 0 ? 'unthrottled' : o.tokensPerSecond} |
| tool updates / latency | ${o.toolUpdates} / ${o.toolLatencyMs} ms |
| determinism checks | ${o.checkDeterminism ? 'on' : 'off'} |
| plugins | ${['probe', ...pluginNames(o.plugins ?? []), ...(o.otel ? ['otel'] : []), ...(o.events ? ['jsonl'] : [])].join(', ')} |

## Throughput

| cases/s | model turns/s | tool calls/s | events/s |
| ---: | ---: | ---: | ---: |
| ${fmt(stats.throughput.casesPerSec)} | ${fmt(stats.throughput.turnsPerSec)} | ${fmt(stats.throughput.toolCallsPerSec)} | ${fmt(stats.throughput.eventsPerSec)} |

## Latency (ms)

| | p50 | p90 | p99 | max |
| --- | ---: | ---: | ---: | ---: |
| case wall time | ${spreadRow(stats.caseWallMs)} |
| first token (per-case median) | ${spreadRow(stats.firstTokenMs)} |

## Resource cost

| wall | CPU user | CPU system | CPU | CPU / model turn | CPU / event |
| ---: | ---: | ---: | ---: | ---: | ---: |
| ${ms(cost.wallMs)} | ${ms(cost.cpuUserMs)} | ${ms(cost.cpuSystemMs)} | ${fmt(cost.cpuPercent)}% | ${fmt(stats.cpuPerTurnUs)} µs | ${fmt(stats.cpuPerEventUs)} µs |

| heap start → end | heap peak | heap retained after GC | RSS start → peak | GC | event-loop delay p50 / p99 / max | event-loop utilization |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ${mb(cost.heapStartBytes)} → ${mb(cost.heapEndBytes)} | ${mb(cost.heapPeakBytes)} | ${mb(cost.heapRetainedBytes)} | ${mb(cost.rssStartBytes)} → ${mb(cost.rssPeakBytes)} | ${cost.gcCount} × (${ms(cost.gcMs)}) | ${fmt(cost.eventLoopDelayMs.p50)} / ${fmt(cost.eventLoopDelayMs.p99)} / ${fmt(cost.eventLoopDelayMs.max)} ms | ${fmt(cost.eventLoopUtilization * 100)}% |

- The faux provider runs in the measured process and estimates usage by serializing the whole context on every
  request, so its share of CPU grows with history length.
- ${o.tokensPerSecond === 0 ? 'Unthrottled, the faux provider streams in microtasks: a case never yields the event loop until it ends, so event-loop delay is about the longest case. Set --tps for a loop that yields between tokens.' : `At ${o.tokensPerSecond} tokens/s the faux provider yields between tokens, as a network stream would.`}
- Heap growth includes the batch of cases being read and one result row per case.${o.concurrency > 1 ? ' Per-case CPU in the cases file overlaps other cases at this concurrency.' : ''}

## By agent

| agent | cases | passed | model turns | wall p50 | wall p99 |
| --- | ---: | ---: | ---: | ---: | ---: |
${stats.byAgent.map(a => `| ${a.agent} | ${a.cases} | ${a.passed} | ${a.modelTurns} | ${ms(a.wallMs.p50)} | ${ms(a.wallMs.p99)} |`).join('\n')}

## Failures

${failed.length === 0 ? 'None.' : failuresOf(failed, stats)}

## Slowest cases

| case | task | agent | turns | events | wall |
| --- | --- | --- | ---: | ---: | ---: |
${slowest.map(r => `| \`${r.case_id}\`#${r.repeat} | ${r.task} | ${r.agent} | ${r.model_turns} | ${r.events} | ${ms(r.wall_ms)} |`).join('\n')}

## Files

${result.files.map(f => `- \`${join(o.out, f)}\``).join('\n')}

\`\`\`sh
pnpm replay analyze ${o.out}
duckdb -c "SELECT agent, count(*), avg(wall_ms) FROM '${join(o.out, `cases.${ext}`)}' GROUP BY ALL"
\`\`\`
`
}

/** The names in a (possibly nested) plugin list, in order. */
export function pluginNames(list: PluginList): string[] {
  return list.flatMap(item => ('name' in item ? [item.name] : pluginNames(item as PluginList)))
}

function failuresOf(failed: CaseRow[], stats: SuiteStats): string {
  const kinds = Object.entries(stats.failureKinds)
    .toSorted((a, b) => b[1] - a[1])
    .map(([kind, n]) => `| ${kind} | ${n} |`)
    .join('\n')
  const cases = failed
    .slice(0, 20)
    .map(
      r =>
        `- \`${r.case_id}\`#${r.repeat} ${r.task} · ${r.agent}\n${r.failures
          .slice(0, 3)
          .map(f => `  - ${f}`)
          .join('\n')}`,
    )
    .join('\n')
  const more = failed.length > 20 ? `\n\n…and ${failed.length - 20} more; see the cases file.` : ''
  return `| kind | count |\n| --- | ---: |\n${kinds}\n\n${cases}${more}`
}

/** "events (observe): #3 tool_start@t1: …" -> "events (observe)"; "summary.turns 3, script has 4" -> "summary.turns N, script has N". */
function kindOf(failure: string): string {
  const colon = failure.indexOf(':')
  const head = colon === -1 ? failure : failure.slice(0, colon)
  return head.replaceAll(/\d+/g, 'N')
}

function spread(values: number[]): Spread {
  return {
    p50: percentile(values, 50),
    p90: percentile(values, 90),
    p99: percentile(values, 99),
    max: values.reduce((a, b) => Math.max(a, b), 0),
  }
}

function spreadRow(s: Spread): string {
  return [s.p50, s.p90, s.p99, s.max].map(fmt).join(' | ')
}

export function fmt(n: number): string {
  return n >= 100 ? Math.round(n).toLocaleString('en-US') : n.toFixed(n >= 10 ? 1 : 2)
}

export function ms(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${fmt(n)} ms`
}

export function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
