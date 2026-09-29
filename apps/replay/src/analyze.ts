// Reads replay output back with DuckDB: views `cases`, `spans` and `events` over one run's directory, or over every
// run below a directory (then compare runs by replay_run_id), plus a few ready-made questions.

import type { Db } from './dataset.ts'
import type { Table } from './sink.ts'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { openDb } from './dataset.ts'
import { readJsonl } from './sink.ts'

const QUERIES: Record<string, string> = {
  runs: `
    SELECT replay_run_id, count(*) AS cases, count(*) FILTER (ok) AS passed, sum(model_turns) AS turns,
      sum(events) AS events, round(median(wall_ms), 2) AS wall_p50_ms, round(quantile_cont(wall_ms, 0.99), 2) AS wall_p99_ms,
      round(sum(cpu_user_ms + cpu_system_ms) / sum(model_turns) * 1000, 1) AS cpu_us_per_turn
    FROM cases GROUP BY ALL ORDER BY replay_run_id`,
  'by agent': `
    SELECT replay_run_id, agent, count(*) AS cases, count(*) FILTER (ok) AS passed, sum(model_turns) AS turns,
      round(median(wall_ms), 2) AS wall_p50_ms, round(avg(events_per_sec)) AS events_per_sec
    FROM cases GROUP BY ALL ORDER BY replay_run_id, turns DESC`,
  failures: `
    SELECT case_id, repeat, task, agent, unnest(failures[1:3]) AS failure
    FROM cases WHERE NOT ok ORDER BY case_id, repeat LIMIT 30`,
  'time per turn by trajectory length': `
    SELECT (model_turns // 25) * 25 AS turns_from, count(*) AS cases,
      round(avg(wall_ms / model_turns), 3) AS ms_per_turn, round(avg((cpu_user_ms + cpu_system_ms) / model_turns), 3) AS cpu_ms_per_turn
    FROM cases WHERE model_turns > 0 GROUP BY ALL ORDER BY turns_from`,
  'span latency': `
    SELECT attributes->>'gen_ai.operation.name' AS operation, count(*) AS spans,
      round(quantile_cont(duration_ms, 0.5), 3) AS p50_ms, round(quantile_cont(duration_ms, 0.99), 3) AS p99_ms,
      round(max(duration_ms), 3) AS max_ms, count(*) FILTER (status_code = 'ERROR') AS errors
    FROM spans GROUP BY ALL ORDER BY spans DESC`,
  'busiest tools': `
    SELECT attributes->>'gen_ai.tool.name' AS tool, count(*) AS calls, round(sum(duration_ms), 1) AS total_ms,
      round(avg(duration_ms), 3) AS avg_ms
    FROM spans WHERE attributes->>'gen_ai.operation.name' = 'execute_tool' GROUP BY ALL ORDER BY calls DESC LIMIT 10`,
  'tokens by model': `
    SELECT model, count(*) AS chats, sum((attributes->>'gen_ai.usage.input_tokens')::BIGINT) AS input_tokens,
      sum((attributes->>'gen_ai.usage.output_tokens')::BIGINT) AS output_tokens
    FROM spans WHERE attributes->>'gen_ai.operation.name' = 'chat' GROUP BY ALL ORDER BY input_tokens DESC LIMIT 10`,
}

/** An in-memory database with a view per table found under `dir`. */
export async function openRuns(dir: string): Promise<{ db: Db; tables: Table[] }> {
  const db = await openDb()
  return { db, tables: await attachRuns(db, dir) }
}

/** Temporary views over the run files under `dir`, so nothing is written into db itself. Returns the views made. */
export async function attachRuns(db: Db, dir: string): Promise<Table[]> {
  const tables: Table[] = []
  for (const table of ['cases', 'spans', 'events'] as const) {
    const select = selectOf(dir, table)
    if (select !== undefined) {
      await db.connection.run(`CREATE OR REPLACE TEMP VIEW ${table} AS ${select}`)
      tables.push(table)
    }
  }
  return tables
}

export async function analyze(
  dir: string,
  print: (title: string, rows: Array<Record<string, unknown>>) => void,
): Promise<void> {
  const { db, tables } = await openRuns(dir)
  try {
    if (!tables.includes('cases')) {
      throw new Error(`no cases.parquet or cases.jsonl in ${dir} or the directories right below it`)
    }
    for (const [title, sql] of Object.entries(QUERIES)) {
      if (sql.includes('FROM spans') && !tables.includes('spans')) {
        continue
      }
      print(title, await db.query(sql))
    }
  } finally {
    db.close()
  }
}

/** One run's file, or every run's below `dir`; Parquet preferred. */
function selectOf(dir: string, table: Table): string | undefined {
  if (!existsSync(dir)) {
    return undefined
  }
  const runs =
    existsSync(join(dir, `cases.parquet`)) || existsSync(join(dir, `cases.jsonl`))
      ? [dir]
      : readdirSync(dir, { withFileTypes: true })
          .filter(d => d.isDirectory())
          .map(d => join(dir, d.name))

  const selects = runs.flatMap(run => {
    const parquet = join(run, `${table}.parquet`)
    const jsonl = join(run, `${table}.jsonl`)
    if (existsSync(parquet)) {
      return [`SELECT * FROM read_parquet('${parquet.replaceAll(`'`, `''`)}')`]
    }
    return existsSync(jsonl) ? [readJsonl(table, jsonl)] : []
  })
  return selects.length === 0 ? undefined : selects.join(' UNION ALL BY NAME ')
}
