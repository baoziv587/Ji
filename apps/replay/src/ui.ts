// Terminal output shared by the commands: aligned tables, the end-of-run summary, and prompt cancellation.

import type { SuiteStats } from './report.ts'
import type { CaseRow, SuiteResult } from './runner.ts'
import { styleText } from 'node:util'
import { isCancel } from '@clack/prompts'
import { fmt, mb, ms } from './report.ts'

/** Thrown when the person cancels a prompt (Ctrl+C or Esc); the CLI ends quietly. */
export class Cancelled extends Error {
  constructor() {
    super('cancelled')
    this.name = 'Cancelled'
  }
}

/** A prompt's answer, or Cancelled. */
export async function ask<T>(prompt: Promise<T | symbol>): Promise<Exclude<T, symbol>> {
  const answer = await prompt
  if (isCancel(answer)) {
    throw new Cancelled()
  }
  return answer as Exclude<T, symbol>
}

const NUMERIC = /^-?\d+(?:\.\d+)?$/

/** Rows as aligned columns: numbers to the right, long values cut at `maxWidth`, the header dimmed. */
export function table(rows: ReadonlyArray<Record<string, unknown>>, maxWidth = 60): string {
  if (rows.length === 0) {
    return styleText('dim', '(no rows)')
  }

  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))]
  const cells = rows.map(row => columns.map(column => cellOf(row[column], maxWidth)))
  const numeric = columns.map((_, i) => cells.every(row => row[i] === '' || NUMERIC.test(row[i])))
  const widths = columns.map((column, i) => cells.reduce((w, row) => Math.max(w, row[i].length), column.length))

  const line = (values: string[]): string =>
    values
      .map((value, i) => (numeric[i] ? value.padStart(widths[i]) : value.padEnd(widths[i])))
      .join('  ')
      .trimEnd()
  return [styleText('dim', line(columns)), ...cells.map(line)].join('\n')
}

function cellOf(value: unknown, maxWidth: number): string {
  const text =
    value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  const flat = text.replaceAll(/\s+/g, ' ')
  return flat.length > maxWidth ? `${flat.slice(0, maxWidth - 1)}…` : flat
}

/** The few numbers worth seeing right after a run; the rest is in report.md. */
export function summaryOf({ cost, options, files }: SuiteResult, stats: SuiteStats): string {
  const passed = stats.failed === 0
  return [
    [
      'cases',
      `${stats.passed.toLocaleString('en-US')} passed${passed ? '' : `, ${styleText('red', `${stats.failed} failed`)}`}`,
    ],
    [
      'work',
      `${stats.modelTurns.toLocaleString('en-US')} model turns · ${stats.toolCalls.toLocaleString('en-US')} tool calls · ${stats.events.toLocaleString('en-US')} events`,
    ],
    ['throughput', `${fmt(stats.throughput.casesPerSec)} cases/s · ${fmt(stats.throughput.eventsPerSec)} events/s`],
    [
      'case time',
      `p50 ${ms(stats.caseWallMs.p50)} · p99 ${ms(stats.caseWallMs.p99)} · max ${ms(stats.caseWallMs.max)}`,
    ],
    [
      'cpu',
      `${ms(cost.cpuUserMs + cost.cpuSystemMs)} (${fmt(cost.cpuPercent)}%) · ${fmt(stats.cpuPerTurnUs)} µs per model turn`,
    ],
    [
      'memory',
      `heap peak ${mb(cost.heapPeakBytes)} · retained ${mb(cost.heapRetainedBytes)} · RSS peak ${mb(cost.rssPeakBytes)}`,
    ],
    ['gc', `${cost.gcCount} × ${ms(cost.gcMs)} · event-loop delay p99 ${fmt(cost.eventLoopDelayMs.p99)} ms`],
    ['output', options.out],
    ['files', files.join(', ')],
  ]
    .map(([label, value]) => `${styleText('dim', label.padEnd(10))}  ${value}`)
    .join('\n')
}

/** One failed case: where it came from and its first few failures. */
export function failureOf(row: CaseRow): string {
  const head = `${row.case_id}#${row.repeat}  ${styleText('dim', `${row.task} · ${row.agent} · ${row.model}`)}`
  return [head, ...row.failures.slice(0, 3).map(f => `  ${f}`)].join('\n')
}
