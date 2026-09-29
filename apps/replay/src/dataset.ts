// Terminal-Bench trajectories in DuckDB: import once into a local database file, then select cases with SQL.
//
//   importTrials(db, (await ensureDataset()).files)     the cached parquet files (see cache.ts)
//   importTrials(db, 'fixtures/sample.jsonl')           or any parquet / JSONL path or URL DuckDB can read
//     -> table trials: the dataset's columns with fixed types, plus case_id, n_steps and n_tool_calls
//
// Rows whose steps are missing ('null' in the dataset) are left out: there is nothing to replay. Most rows have an
// empty trial_id, so case_id falls back to trial_name, which is unique among them.

import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'

export const DEFAULT_DB = '.replay/terminalbench.duckdb'

export interface Db {
  readonly connection: DuckDBConnection
  /** Rows as plain JSON values: BIGINT and DECIMAL come back as strings. */
  query: (sql: string, values?: DuckDBValue[]) => Promise<Array<Record<string, unknown>>>
  close: () => void
}

/** ':memory:' for a throwaway database; a file path creates its directory first. */
export async function openDb(path = ':memory:'): Promise<Db> {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true })
  }

  const instance = await DuckDBInstance.create(path)
  const connection = await instance.connect()
  return {
    connection,
    query: async (sql, values) => (await connection.runAndReadAll(sql, values)).getRowObjectsJson(),
    close: () => {
      connection.closeSync()
      instance.closeSync()
    },
  }
}

/** Replaces the trials table with the rows of `source`: parquet files, or JSON lines with the same columns. */
export async function importTrials(db: Db, source: string | readonly string[]): Promise<number> {
  await db.connection.run(`
    CREATE OR REPLACE TABLE trials AS
    SELECT
      coalesce(nullif(trial_id::VARCHAR, ''), trial_name::VARCHAR) AS case_id,
      trial_id::VARCHAR AS trial_id,
      trial_name::VARCHAR AS trial_name,
      task_name::VARCHAR AS task_name,
      agent::VARCHAR AS agent,
      model::VARCHAR AS model,
      reward::INTEGER AS reward,
      duration_seconds::DOUBLE AS duration_seconds,
      input_tokens::DOUBLE AS input_tokens,
      output_tokens::DOUBLE AS output_tokens,
      cache_tokens::DOUBLE AS cache_tokens,
      cost_cents::DOUBLE AS cost_cents,
      started_at::VARCHAR AS started_at,
      ended_at::VARCHAR AS ended_at,
      json_array_length(steps)::INTEGER AS n_steps,
      coalesce(list_sum(list_transform(json_extract(steps, '$[*].tools'), t -> coalesce(json_array_length(t), 0))), 0)::INTEGER AS n_tool_calls,
      steps::VARCHAR AS steps
    FROM ${readerOf(source)}
    WHERE steps IS NOT NULL AND steps <> 'null'
  `)

  const [row] = await db.query('SELECT count(*) AS n FROM trials')
  return Number(row.n)
}

/** Whether the trials table has been imported into this database. */
export async function hasTrials(db: Db): Promise<boolean> {
  const rows = await db.query(`SELECT 1 FROM duckdb_tables() WHERE table_name = 'trials'`)
  return rows.length > 0
}

/** DuckDB table functions take no prepared parameters, so the path goes in as an escaped literal. */
function readerOf(source: string | readonly string[]): string {
  const paths = typeof source === 'string' ? [source] : source
  const list = `[${paths.map(p => `'${p.replaceAll(`'`, `''`)}'`).join(', ')}]`
  return paths.every(p => /\.(?:jsonl|ndjson|json)$/i.test(p)) ? `read_json_auto(${list})` : `read_parquet(${list})`
}
