// Picking cases out of the trials table: a filter is data, whereOf turns it into SQL, selectIds runs it.
//
//   const ids = await selectIds(db, { agent: ['claude-code', 'codex'], reward: 1, maxSteps: 200, limit: 50, seed: 7 })
//   for await (const c of streamCases(db, ids)) ...        a batch of steps in memory at a time
//   await selectCases(db, filter)                          or all of them at once, for small selections
//
// Every field narrows the selection; `where` is a raw SQL predicate for anything the fields do not cover
// (say "task_name LIKE 'chess%'"). With `seed`, rows come in a fixed pseudo-random order instead of by case_id,
// so `limit` takes a reproducible sample.

import type { DuckDBValue } from '@duckdb/node-api'
import type { Db } from './dataset.ts'

export interface CaseFilter {
  agent?: string | string[]
  model?: string | string[]
  task?: string | string[]
  /** case_id: the trial_id, or the trial_name where the dataset has no trial_id. */
  id?: string | string[]
  reward?: 0 | 1
  minSteps?: number
  maxSteps?: number
  minToolCalls?: number
  maxToolCalls?: number
  /** A raw SQL predicate over the trials table, ANDed with the fields above. */
  where?: string
  limit?: number
  seed?: number
}

/** One recorded trial, ready to be turned into a replay script. */
export interface Case {
  id: string
  task: string
  agent: string
  model: string
  reward: number
  steps: TrajectoryStep[]
}

/** The dataset's step, normalized: msg is never null, tools never null, cmd always a string. */
export interface TrajectoryStep {
  src: 'user' | 'agent' | 'system'
  msg: string
  tools: Array<{ fn: string; cmd: string }>
  obs: string | null
}

export interface Where {
  sql: string
  values: DuckDBValue[]
}

const LIST_FIELDS = [
  ['agent', 'agent'],
  ['model', 'model'],
  ['task', 'task_name'],
  ['id', 'case_id'],
] as const

const RANGE_FIELDS = [
  ['minSteps', 'n_steps >= ?'],
  ['maxSteps', 'n_steps <= ?'],
  ['minToolCalls', 'n_tool_calls >= ?'],
  ['maxToolCalls', 'n_tool_calls <= ?'],
  ['reward', 'reward = ?'],
] as const

/** The WHERE clause of a filter, with positional parameters; 'TRUE' when nothing narrows it. */
export function whereOf(filter: CaseFilter): Where {
  const clauses: string[] = []
  const values: DuckDBValue[] = []

  for (const [field, column] of LIST_FIELDS) {
    const wanted = listOf(filter[field])
    if (wanted.length > 0) {
      clauses.push(`${column} IN (${wanted.map(() => '?').join(', ')})`)
      values.push(...wanted)
    }
  }
  for (const [field, clause] of RANGE_FIELDS) {
    const value = filter[field]
    if (value !== undefined) {
      clauses.push(clause)
      values.push(value)
    }
  }
  if (filter.where !== undefined && filter.where.trim() !== '') {
    clauses.push(`(${filter.where})`)
  }

  return { sql: clauses.length === 0 ? 'TRUE' : clauses.join(' AND '), values }
}

/** Every case a filter selects, steps and all. For a large selection, streamCases keeps memory flat. */
export async function selectCases(db: Db, filter: CaseFilter = {}): Promise<Case[]> {
  return loadCases(db, await selectIds(db, filter))
}

/** The case_ids a filter selects, in run order: cheap to hold even for the whole dataset. */
export async function selectIds(db: Db, filter: CaseFilter = {}): Promise<string[]> {
  const { sql, values } = whereOf(filter)
  const order = filter.seed === undefined ? 'case_id' : `hash(case_id || ?), case_id`
  const limit = filter.limit === undefined ? '' : 'LIMIT ?'

  const rows = await db.query(`SELECT case_id FROM trials WHERE ${sql} ORDER BY ${order} ${limit}`, [
    ...values,
    ...(filter.seed === undefined ? [] : [String(filter.seed)]),
    ...(filter.limit === undefined ? [] : [filter.limit]),
  ])
  return rows.map(row => String(row.case_id))
}

/** Reads `ids` a batch at a time, so only one batch of steps is in memory while the cases run. */
export async function* streamCases(db: Db, ids: readonly string[], batchSize = 100): AsyncGenerator<Case> {
  for (let i = 0; i < ids.length; i += batchSize) {
    yield* await loadCases(db, ids.slice(i, i + batchSize))
  }
}

async function loadCases(db: Db, ids: readonly string[]): Promise<Case[]> {
  if (ids.length === 0) {
    return []
  }

  const rows = await db.query(
    `SELECT case_id, task_name, agent, model, reward, steps FROM trials WHERE case_id IN (${ids.map(() => '?').join(', ')})`,
    [...ids],
  )
  const byId = new Map(rows.map(row => [String(row.case_id), row]))
  return ids.flatMap(id => {
    const row = byId.get(id)
    return row === undefined ? [] : [caseOf(row)]
  })
}

/** How many cases a filter selects, by agent and model: a look before a long run. */
export async function countCases(db: Db, filter: CaseFilter = {}): Promise<Array<Record<string, unknown>>> {
  const { sql, values } = whereOf(filter)
  return db.query(
    `SELECT agent, model, count(*) AS trials, sum(reward) AS solved, median(n_steps) AS median_steps,
            sum(n_tool_calls) AS tool_calls
     FROM trials WHERE ${sql} GROUP BY ALL ORDER BY trials DESC`,
    values,
  )
}

function caseOf(row: Record<string, unknown>): Case {
  const steps = JSON.parse(String(row.steps)) as unknown[]
  return {
    id: String(row.case_id),
    task: String(row.task_name),
    agent: String(row.agent),
    model: String(row.model),
    reward: Number(row.reward ?? 0),
    steps: steps.map(stepOf),
  }
}

interface RawStep {
  src?: string
  msg?: string | null
  tools?: Array<{ fn?: string; cmd?: unknown }> | null
  obs?: string | null
}

function stepOf(raw: unknown): TrajectoryStep {
  const step = raw as RawStep
  return {
    src: step.src === 'user' || step.src === 'system' ? step.src : 'agent',
    msg: step.msg ?? '',
    tools: (step.tools ?? []).map(t => ({
      fn: t.fn ?? 'tool',
      // codex records argv arrays; everything else a string
      cmd: typeof t.cmd === 'string' ? t.cmd : (JSON.stringify(t.cmd) ?? ''),
    })),
    obs: step.obs ?? null,
  }
}

function listOf(value: string | string[] | undefined): string[] {
  if (value === undefined) {
    return []
  }
  return Array.isArray(value) ? value : [value]
}
