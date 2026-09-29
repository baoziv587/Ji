import type { Plugin } from '@ji.dev/llm'
import type { SuiteOptions } from '../src/runner.ts'
import type { Case } from '../src/testkit.ts'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, definePlugin } from '@ji.dev/llm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openRuns } from '../src/analyze.ts'
import { importTrials, openDb } from '../src/dataset.ts'
import { runSuite } from '../src/runner.ts'
import { selectCases } from '../src/testkit.ts'

const FIXTURE = fileURLToPath(new URL('../fixtures/terminalbench-sample.jsonl', import.meta.url))

let cases: Case[]
let dir: string

beforeAll(async () => {
  const db = await openDb()
  await importTrials(db, FIXTURE)
  cases = await selectCases(db)
  db.close()
  dir = mkdtempSync(join(tmpdir(), 'ji-replay-'))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function optionsFor(name: string, patch: Partial<SuiteOptions> = {}): SuiteOptions {
  return {
    source: FIXTURE,
    filter: {},
    out: join(dir, name),
    format: 'jsonl',
    concurrency: 3,
    repeat: 1,
    timeoutMs: 10_000,
    tokensPerSecond: 0,
    toolUpdates: 0,
    toolLatencyMs: 0,
    checkDeterminism: true,
    otel: false,
    events: false,
    ...patch,
  }
}

describe('runSuite', () => {
  it('should replay every fixture case correctly and write Parquet that DuckDB reads back', async () => {
    // Arrange
    const options = optionsFor('parquet', { format: 'parquet', otel: true, events: true, repeat: 2, toolUpdates: 3 })

    // Act
    const result = await runSuite(cases, options)

    // Assert
    expect(result.rows.filter(r => !r.ok).map(r => r.failures)).toEqual([])
    expect(result.rows).toHaveLength(cases.length * 2)
    expect(result.files).toEqual(['cases.parquet', 'spans.parquet', 'events.parquet', 'summary.json', 'report.md'])
    expect(existsSync(join(options.out, 'cases.jsonl'))).toBe(false)

    const { db, tables } = await openRuns(options.out)
    try {
      expect(tables).toEqual(['cases', 'spans', 'events'])
      const [row] = await db.query(`
        SELECT (SELECT sum(model_turns) FROM cases) AS turns,
               (SELECT count(*) FROM spans WHERE attributes->>'gen_ai.operation.name' = 'chat') AS chats,
               (SELECT count(*) FROM spans WHERE parent_span_id IS NULL) AS roots,
               (SELECT count(*) FROM events WHERE type = 'tool_update') AS updates,
               (SELECT sum(tool_calls) FROM cases) AS calls`)
      expect(Number(row.chats)).toBe(Number(row.turns))
      expect(Number(row.roots)).toBe(cases.length * 2)
      expect(Number(row.updates)).toBe(Number(row.calls) * 3)
    } finally {
      db.close()
    }
    expect(readFileSync(join(options.out, 'report.md'), 'utf8')).toContain(
      `✅ ${cases.length * 2}/${cases.length * 2} cases passed`,
    )
  })

  it('should keep JSONL when asked for it, and analyze it the same way', async () => {
    // Arrange
    const options = optionsFor('jsonl', { otel: true, concurrency: 1 })

    // Act
    const result = await runSuite(cases, options)

    // Assert
    expect(result.files.slice(0, 2)).toEqual(['cases.jsonl', 'spans.jsonl'])
    const { db } = await openRuns(options.out)
    try {
      const [row] = await db.query(`SELECT count(*) FILTER (ok) AS passed, sum(cpu_user_ms) > 0 AS measured FROM cases`)
      expect(row).toEqual({ passed: String(cases.length), measured: true })
    } finally {
      db.close()
    }
  })

  it('should not be disturbed by a plugin whose observe throws', async () => {
    // Arrange
    const noisy = definePlugin({
      name: 'noisy',
      observe: e => {
        if (e.type === 'run_end') {
          throw new Error('observer bug')
        }
      },
    })

    // Act
    const result = await runSuite(cases.slice(0, 2), optionsFor('noisy', { plugins: [noisy] }))

    // Assert
    expect(result.rows.every(r => r.ok)).toBe(true)
  })
})

describe('runSuite with a faulty plugin under test', () => {
  const faulty: Array<[string, Plugin, RegExp]> = [
    [
      'a record hook that drops tool results',
      definePlugin({
        name: 'drop-results',
        record: (input, next) =>
          next(input.turn.kind === 'model' ? { ...input, turn: { ...input.turn, results: [] } } : input),
      }),
      /^history has \d+ messages, script has \d+/m,
    ],
    [
      'a request hook that sends only part of the history',
      definePlugin({ name: 'window', request: before(req => ({ ...req, messages: req.messages.slice(-2) })) }),
      /^model: request \d+: 2 messages/m,
    ],
    [
      'a toolCall hook that rewrites results',
      definePlugin({
        name: 'tamper',
        toolCall: after(result => ({ ...result, content: [{ type: 'text', text: 'tampered' }] })),
      }),
      /^history\[\d+\] is .*tampered/m,
    ],
  ]

  it.each(faulty)('should catch %s', async (_, plugin, failure) => {
    // Act
    const result = await runSuite(cases.slice(0, 3), optionsFor(plugin.name, { plugins: [plugin] }))

    // Assert
    expect(result.rows.every(r => !r.ok)).toBe(true)
    for (const row of result.rows) {
      expect(row.failures.join('\n')).toMatch(failure)
    }
  })
})
