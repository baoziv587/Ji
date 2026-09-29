// Where a replay run's rows go: JSON lines while it runs, Parquet afterwards if asked for.
//
//   cases.jsonl    one row per case: verdict, failures, counts, time, CPU, memory
//   spans.jsonl    OTEL spans from @ji.dev/plugin-otel (see spans.ts)
//   events.jsonl   (optional) every run event from @ji.dev/plugin-jsonl, tagged with its case
//
// Parquet is written by DuckDB from the JSONL, with fixed column types so every run's files line up in one query.

import type { Db } from './dataset.ts'
import { once } from 'node:events'
import { createWriteStream } from 'node:fs'

export type Table = 'cases' | 'spans' | 'events'

export interface Sink {
  readonly path: string
  write: (row: object) => void
  writeLine: (line: string) => void
  close: () => Promise<void>
}

export function jsonlSink(path: string): Sink {
  const stream = createWriteStream(path, { encoding: 'utf8' })
  return {
    path,
    write: row => stream.write(`${JSON.stringify(row)}\n`),
    writeLine: line => stream.write(`${line}\n`),
    close: async () => {
      stream.end()
      await once(stream, 'finish')
    },
  }
}

const COLUMNS: Record<Exclude<Table, 'events'>, Record<string, string>> = {
  cases: {
    replay_run_id: 'VARCHAR',
    case_id: 'VARCHAR',
    repeat: 'INTEGER',
    task: 'VARCHAR',
    agent: 'VARCHAR',
    model: 'VARCHAR',
    reward: 'INTEGER',
    ok: 'BOOLEAN',
    failures: 'VARCHAR[]',
    error_kind: 'VARCHAR',
    model_turns: 'INTEGER',
    synthetic_turns: 'INTEGER',
    tool_calls: 'INTEGER',
    inputs: 'INTEGER',
    history_messages: 'INTEGER',
    events: 'INTEGER',
    text_chars: 'BIGINT',
    input_tokens: 'BIGINT',
    output_tokens: 'BIGINT',
    wall_ms: 'DOUBLE',
    model_ms: 'DOUBLE',
    tool_ms: 'DOUBLE',
    first_token_ms_p50: 'DOUBLE',
    cpu_user_ms: 'DOUBLE',
    cpu_system_ms: 'DOUBLE',
    heap_delta_bytes: 'BIGINT',
    events_per_sec: 'DOUBLE',
    concurrency: 'INTEGER',
    started_at: 'TIMESTAMPTZ',
  },
  spans: {
    replay_run_id: 'VARCHAR',
    case_id: 'VARCHAR',
    repeat: 'INTEGER',
    task: 'VARCHAR',
    agent: 'VARCHAR',
    model: 'VARCHAR',
    trace_id: 'VARCHAR',
    span_id: 'VARCHAR',
    parent_span_id: 'VARCHAR',
    name: 'VARCHAR',
    kind: 'VARCHAR',
    start_time_unix_nano: 'UBIGINT',
    end_time_unix_nano: 'UBIGINT',
    duration_ms: 'DOUBLE',
    status_code: 'VARCHAR',
    status_message: 'VARCHAR',
    attributes: 'JSON',
    events: 'JSON',
  },
}

/** A SELECT over a table's JSONL file with its fixed column types; events keep each line as one JSON value. */
export function readJsonl(table: Table, path: string): string {
  const file = `'${path.replaceAll(`'`, `''`)}'`
  if (table === 'events') {
    return `SELECT json->>'case_id' AS case_id, (json->>'repeat')::INTEGER AS repeat, json->>'run' AS run_id,
              (json->>'t')::INTEGER AS t, json->>'type' AS type, json AS payload
            FROM read_json_objects(${file}, format = 'newline_delimited')`
  }

  const columns = Object.entries(COLUMNS[table])
    .map(([name, type]) => `'${name}': '${type}'`)
    .join(', ')
  return `SELECT * FROM read_json(${file}, format = 'newline_delimited', columns = {${columns}})`
}

export async function toParquet(db: Db, table: Table, jsonlPath: string, parquetPath: string): Promise<void> {
  const out = `'${parquetPath.replaceAll(`'`, `''`)}'`
  await db.connection.run(`COPY (${readJsonl(table, jsonlPath)}) TO ${out} (FORMAT parquet, COMPRESSION zstd)`)
}
