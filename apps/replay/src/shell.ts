// A small SQL shell over the replay database, for when the duckdb CLI is not installed:
//
//   pnpm replay:shell                                   interactive; a statement runs once it ends with ';'
//   pnpm replay:shell "SELECT count(*) FROM trials"      one statement, then exit
//   echo "FROM cases LIMIT 5;" | pnpm replay:shell       statements from stdin
//
// Dot commands: .tables  .schema <table>  .help  .quit

import type { Db } from './dataset.ts'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { createInterface } from 'node:readline/promises'
import { table } from './ui.ts'

/** Rows beyond this are counted, not printed. */
const MAX_ROWS = 100
const HELP = `.tables            tables and views: trials (the dataset), cases / spans / events (replay runs)
.schema <table>    its columns and types
.quit              leave (or Ctrl-D)
Anything else is SQL, run once it ends with ';'.`

export async function shell(db: Db): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: 'duckdb> ' })
  const interactive = process.stdin.isTTY === true
  if (interactive) {
    console.log(`${HELP}\n`)
    rl.prompt()
  }

  let buffer = ''
  for await (const line of rl) {
    const text = line.trim()
    if (buffer === '' && text.startsWith('.')) {
      if (text === '.quit' || text === '.exit') {
        break
      }
      await run(db, dotCommand(text))
    } else {
      buffer = `${buffer}${line}\n`
      if (text.endsWith(';')) {
        await run(db, buffer)
        buffer = ''
      }
    }
    rl.setPrompt(buffer === '' ? 'duckdb> ' : '   ...> ')
    if (interactive) {
      rl.prompt()
    }
  }
  if (buffer.trim() !== '') {
    await run(db, buffer)
  }
  rl.close()
}

/** Runs one statement and prints its rows; an error is printed, never thrown, so the shell keeps going. */
export async function run(
  db: Db,
  sql: string | undefined,
  print: (text: string) => void = text => console.log(text),
): Promise<void> {
  if (sql === undefined) {
    print(HELP)
    return
  }

  const start = performance.now()
  try {
    const rows = await db.query(sql)
    const ms = (performance.now() - start).toFixed(1)
    if (rows.length === 0) {
      print(`ok (${ms} ms)`)
      return
    }
    const more = rows.length > MAX_ROWS ? `, first ${MAX_ROWS} shown; add a LIMIT` : ''
    print(`${table(rows.slice(0, MAX_ROWS))}\n${rows.length} rows${more} (${ms} ms)`)
  } catch (error) {
    print(error instanceof Error ? error.message : String(error))
  }
}

function dotCommand(text: string): string | undefined {
  const [command, arg] = text.split(/\s+/)
  switch (command) {
    case '.tables':
      return `SELECT table_name AS name, table_type AS type FROM information_schema.tables ORDER BY ALL`
    case '.schema':
      return arg === undefined ? undefined : `DESCRIBE ${arg}`
    default:
      return undefined
  }
}
