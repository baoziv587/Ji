// `pnpm replay` with no command, in a terminal: asks what to do and returns the argv that does it, so the CLI runs it
// exactly as if it had been typed (and can print that command for next time).
//
//   what to do -> run | cases | analyze | shell | import | cache
//   run, cases -> which cases: all, a random sample, or picked agents / models / outcome
//   run        -> concurrency, extras (spans, events, checks, pacing), format, then a last confirm

import type { Db } from './dataset.ts'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { autocompleteMultiselect, confirm, multiselect, select, text } from '@clack/prompts'
import { ask } from './ui.ts'

type Command = 'run' | 'cases' | 'analyze' | 'shell' | 'import' | 'cache'

export async function wizard(open: () => Promise<Db>, runsDir: string): Promise<string[]> {
  const runs = listRuns(runsDir)
  const command = await ask(
    select<Command>({
      message: 'What do you want to do?',
      options: [
        { value: 'run', label: 'Replay trajectories', hint: 'verify the agent loop and plugins, measure the cost' },
        { value: 'cases', label: 'Browse the dataset', hint: 'how many cases a filter selects' },
        ...(runs.length === 0
          ? []
          : [{ value: 'analyze' as const, label: 'Analyze past runs', hint: `${runs.length} under ${runsDir}` }]),
        { value: 'shell', label: 'Open a SQL shell', hint: 'trials, cases, spans, events' },
        {
          value: 'import',
          label: 'Import the dataset again',
          hint: 'from the download cache; fetches only a new revision',
        },
        { value: 'cache', label: 'Manage the download cache', hint: 'see it, or clear it' },
      ],
    }),
  )

  switch (command) {
    case 'run':
      return withDb(open, async db => ['run', ...(await pickCases(db, 'run')), ...(await runOptions())])
    case 'cases':
      return withDb(open, async db => ['cases', ...(await pickCases(db, 'cases'))])
    case 'analyze':
      return ['analyze', await pickRun(runs, runsDir)]
    case 'shell':
      return ['shell']
    case 'import': {
      const sure = await ask(
        confirm({ message: 'Replace the imported database with a fresh import?', initialValue: false }),
      )
      return sure ? ['import'] : wizard(open, runsDir)
    }
    case 'cache': {
      const action = await ask(
        select({
          message: 'Download cache',
          options: [
            { value: 'show', label: 'Show what is cached' },
            { value: 'clear', label: 'Clear the downloads', hint: 'the next import downloads again' },
            { value: 'all', label: 'Clear the downloads and the imported database' },
          ],
        }),
      )
      return action === 'show' ? ['cache'] : ['cache', 'clear', ...(action === 'all' ? ['--all'] : [])]
    }
  }
}

async function withDb<T>(open: () => Promise<Db>, f: (db: Db) => Promise<T>): Promise<T> {
  const db = await open()
  try {
    return await f(db)
  } finally {
    db.close()
  }
}

/** Filter flags for the cases to take; for a run, confirmed against how many that is. */
async function pickCases(db: Db, purpose: 'run' | 'cases'): Promise<string[]> {
  const [{ n: total }] = await db.query('SELECT count(*) AS n FROM trials')
  const scope = await ask(
    select({
      message: purpose === 'run' ? 'Which trajectories?' : 'Which part of the dataset?',
      options: [
        { value: 'all', label: 'All of them', hint: `${Number(total).toLocaleString('en-US')} cases` },
        { value: 'sample', label: 'A random sample', hint: 'the same seed picks the same cases' },
        { value: 'pick', label: 'Pick agents, models and outcome' },
      ],
    }),
  )

  const flags: string[] = []
  if (scope === 'sample') {
    flags.push('--limit', await number('How many cases?', '500'), '--seed', await number('Seed', '1'))
  }
  if (scope === 'pick') {
    flags.push(...(await pickFilter(db)))
    const limit = await number('At most how many cases? (empty for all)', '', true)
    if (limit !== '') {
      flags.push('--limit', limit, '--seed', '1')
    }
  }
  return flags
}

async function pickFilter(db: Db): Promise<string[]> {
  const agents = await ask(
    autocompleteMultiselect({
      message: 'Agents (type to search, Tab to select)',
      options: optionsOf(
        await db.query('SELECT agent AS value, count(*) AS n FROM trials GROUP BY ALL ORDER BY n DESC'),
      ),
      required: true,
      maxItems: 10,
    }),
  )

  const inAgents = `agent IN (${agents.map(() => '?').join(', ')})`
  const models = await ask(
    autocompleteMultiselect({
      message: 'Models (Tab to select; none selected: all of them)',
      options: optionsOf(
        await db.query(
          `SELECT model AS value, count(*) AS n FROM trials WHERE ${inAgents} GROUP BY ALL ORDER BY n DESC`,
          agents,
        ),
      ),
      maxItems: 10,
    }),
  )

  const reward = await ask(
    select({
      message: 'Outcome in the recording',
      options: [
        { value: 'any', label: 'Any' },
        { value: '1', label: 'Solved the task' },
        { value: '0', label: 'Did not solve it' },
      ],
    }),
  )

  return [
    '--agent',
    agents.join(','),
    ...(models.length === 0 ? [] : ['--model', models.join(',')]),
    ...(reward === 'any' ? [] : ['--reward', reward]),
  ]
}

async function runOptions(): Promise<string[]> {
  const concurrency = await number('Concurrency', '4')
  const extras = await ask(
    multiselect({
      message: 'Extras',
      options: [
        { value: 'otel', label: 'OTEL spans', hint: 'spans.parquet' },
        { value: 'events', label: 'Every run event', hint: 'events.parquet; large for a full run' },
        { value: 'checks', label: 'Determinism checks', hint: 'freezes state and runs reducers twice; slower' },
        { value: 'paced', label: 'Network-paced streaming', hint: '20k tokens/s: the loop yields between tokens' },
        { value: 'updates', label: 'Streamed tool output', hint: '4 tool_update events per call' },
      ],
      initialValues: ['otel'],
      required: false,
    }),
  )
  const format = await ask(
    select({
      message: 'Output format',
      options: [
        { value: 'parquet', label: 'Parquet', hint: 'compact, typed' },
        { value: 'jsonl', label: 'JSON lines', hint: 'greppable' },
      ],
    }),
  )

  return [
    '--concurrency',
    concurrency,
    ...(extras.includes('otel') ? [] : ['--no-otel']),
    ...(extras.includes('events') ? ['--events'] : []),
    ...(extras.includes('checks') ? ['--checks'] : []),
    ...(extras.includes('paced') ? ['--tps', '20000'] : []),
    ...(extras.includes('updates') ? ['--tool-updates', '4'] : []),
    ...(format === 'parquet' ? [] : ['--format', format]),
  ]
}

async function pickRun(runs: string[], runsDir: string): Promise<string> {
  return ask(
    select({
      message: 'Which runs?',
      options: [
        { value: runsDir, label: 'All of them together', hint: 'compare by replay_run_id' },
        ...runs.map(run => ({ value: join(runsDir, run), label: run })),
      ],
      maxItems: 12,
    }),
  )
}

/** Run directories under dir, newest first (their names start with a timestamp). */
function listRuns(dir: string): string[] {
  if (!existsSync(dir)) {
    return []
  }
  return readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory() && ['cases.parquet', 'cases.jsonl'].some(f => existsSync(join(dir, d.name, f))))
    .map(d => d.name)
    .toSorted()
    .toReversed()
}

async function number(message: string, initialValue: string, optional = false): Promise<string> {
  const answer = await ask(
    text({
      message,
      initialValue,
      validate: value => {
        const v = (value ?? '').trim()
        return (optional && v === '') || /^\d+$/.test(v) ? undefined : 'a whole number'
      },
    }),
  )
  return answer.trim()
}

function optionsOf(rows: Array<Record<string, unknown>>): Array<{ value: string; label: string; hint: string }> {
  return rows.map(row => ({
    value: String(row.value),
    label: String(row.value),
    hint: `${Number(row.n).toLocaleString('en-US')} cases`,
  }))
}

/** The wizard is only offered where someone can answer it. */
export function canAsk(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true && process.env.CI !== 'true'
}
