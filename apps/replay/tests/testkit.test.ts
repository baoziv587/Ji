import type { Db } from '../src/dataset.ts'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { importTrials, openDb } from '../src/dataset.ts'
import { countCases, selectCases, selectIds, streamCases, whereOf } from '../src/testkit.ts'

const FIXTURE = fileURLToPath(new URL('../fixtures/terminalbench-sample.jsonl', import.meta.url))

describe('whereOf', () => {
  it('should AND every field, with its values in placeholder order', () => {
    // Act
    const where = whereOf({
      agent: ['codex', 'goose'],
      task: 'chess',
      minSteps: 5,
      reward: 1,
      where: `model LIKE 'gpt%'`,
    })

    // Assert
    expect(where.sql).toBe(
      `agent IN (?, ?) AND task_name IN (?) AND n_steps >= ? AND reward = ? AND (model LIKE 'gpt%')`,
    )
    expect(where.values).toEqual(['codex', 'goose', 'chess', 5, 1])
  })

  it('should select everything when nothing narrows it', () => {
    expect(whereOf({ where: '  ' })).toEqual({ sql: 'TRUE', values: [] })
  })
})

describe('selectCases', () => {
  let db: Db
  beforeAll(async () => {
    db = await openDb()
    await importTrials(db, FIXTURE)
  })
  afterAll(() => db.close())

  it('should import every trial with its step and tool-call counts', async () => {
    // Act
    const [row] = await db.query(
      `SELECT count(*) AS n, count(DISTINCT case_id) AS ids, min(n_tool_calls) AS calls FROM trials`,
    )

    // Assert
    expect(row).toEqual({ n: '6', ids: '6', calls: 7 })
  })

  it('should return the cases a filter picks, with their steps parsed and normalized', async () => {
    // Act
    const cases = await selectCases(db, { agent: ['codex', 'terminus-2'], reward: 1 })

    // Assert
    expect(cases.map(c => c.agent).toSorted()).toEqual(['codex', 'terminus-2'])
    const codex = cases.find(c => c.agent === 'codex')!
    const argv = codex.steps.flatMap(s => s.tools).find(t => t.cmd.startsWith('['))
    expect(argv?.cmd).toMatch(/^\["bash","-lc",/)
    expect(codex.steps.every(s => typeof s.msg === 'string' && Array.isArray(s.tools))).toBe(true)
  })

  it('should take the same sample for the same seed, and honor the limit', async () => {
    // Act
    const a = await selectCases(db, { seed: 7, limit: 3 })
    const b = await selectCases(db, { seed: 7, limit: 3 })
    const all = await selectCases(db, { seed: 7 })

    // Assert
    expect(a.map(c => c.id)).toEqual(b.map(c => c.id))
    expect(a.map(c => c.id)).toEqual(all.slice(0, 3).map(c => c.id))
  })

  it('should stream the selected cases a batch at a time, in selection order', async () => {
    // Arrange
    const ids = await selectIds(db, { seed: 3 })

    // Act
    const streamed: string[] = []
    for await (const c of streamCases(db, ids, 4)) {
      streamed.push(c.id)
    }

    // Assert
    expect(streamed).toEqual(ids)
    expect(streamed).toHaveLength(6)
  })

  it('should count what a filter selects by agent and model', async () => {
    // Act
    const rows = await countCases(db, { minToolCalls: 10 })

    // Assert
    expect(rows.map(r => r.agent).toSorted()).toEqual(['codex', 'mini-swe-agent', 'openhands', 'terminus-2'])
  })
})
