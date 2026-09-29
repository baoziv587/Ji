// pnpm replay [command] [options]
//
//   (none)   in a terminal: a wizard that builds the command, prints it, and runs it
//   import   [--source file|url] [--db file]         load trajectories into DuckDB; run and cases do it when needed
//   cache    [clear [--all] [--yes]]                 the downloaded dataset: where, which revision, how big; or delete it
//   cases    [filter]                                how many cases a filter selects, by agent and model
//   run      [filter] [run options]                  replay the selected cases (default: all), verify, measure, write
//   analyze  [dir]                                   ready-made DuckDB queries over one run, or every run below dir
//   shell    ["<sql>"] [--runs dir]                  SQL over trials plus cases / spans / events of every run
//
// Filter: --agent a,b --model m --task t --id case_id --reward 0|1 --min-steps n --max-steps n
//         --min-tool-calls n --max-tool-calls n --where "<sql>" --limit n --seed n
// Run:    --concurrency 4 --repeat 1 --max-turns n --tps 0 --tool-updates 0 --tool-latency 0 --timeout 60000
//         --format parquet|jsonl --out dir --no-otel --events --checks
//         --plugin ./my-plugin.ts   a plugin under test (repeatable): default export, a Plugin or a function making one
//         --source file  runs straight from a parquet/JSONL file instead of the imported database
// Cache:  --cache dir   where the dataset is downloaded (default ~/.cache/ji-replay); downloaded once per revision
//
// With a command, nothing is asked: flags decide everything, so scripts and CI get the same behavior.

import type { Plugin } from '@ji.dev/llm'
import type { Args, Cli } from './args.ts'
import type { Db } from './dataset.ts'
import type { CaseRow } from './runner.ts'
import { existsSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { styleText } from 'node:util'
import { cancel, confirm, intro, log, note, outro, progress, spinner } from '@clack/prompts'
import { analyze, attachRuns } from './analyze.ts'
import { commandLine, filterOf, int, parse } from './args.ts'
import { clearCache, DATASET, ensureDataset, listCache } from './cache.ts'
import { hasTrials, importTrials, openDb } from './dataset.ts'
import { mb } from './report.ts'
import { replayRunId, runSuite } from './runner.ts'
import { run, shell } from './shell.ts'
import { countCases, selectIds, streamCases } from './testkit.ts'
import { ask, Cancelled, failureOf, summaryOf, table } from './ui.ts'
import { canAsk, wizard } from './wizard.ts'

/** Failed cases listed in the terminal; the rest are in the report and the cases file. */
const SHOWN_FAILURES = 10

try {
  process.exitCode = await main(process.argv.slice(2))
} catch (error) {
  if (error instanceof Cancelled) {
    cancel('Cancelled.')
    process.exitCode = 130
  } else {
    cancel(error instanceof Error ? error.message : String(error))
    process.exitCode = 2
  }
}

async function main(argv: string[]): Promise<number> {
  if (argv.length === 0 && !canAsk()) {
    log.error('usage: pnpm replay <run | cases | analyze | shell | import> [options]; see apps/replay/README.md')
    return 2
  }

  let cli = parse(argv)
  intro(styleText('inverse', ` ji replay${cli.command === undefined ? '' : ` · ${cli.command}`} `))

  if (argv.length === 0) {
    const built = await wizard(() => openSource(cli.args), cli.args.runs)
    log.info(`Same as ${styleText('cyan', commandLine(built))}`)
    cli = parse(built)
  }

  switch (cli.command) {
    case 'import':
      return importCommand(cli.args)
    case 'cases':
      return casesCommand(cli.args)
    case 'run':
      return runCommand(cli.args)
    case 'analyze':
      return analyzeCommand(cli)
    case 'shell':
      return shellCommand(cli)
    case 'cache':
      return cacheCommand(cli)
    default:
      log.error(`unknown command "${cli.command}"; try run, cases, analyze, shell, import or cache`)
      return 2
  }
}

async function importCommand(args: Args): Promise<number> {
  const source = args.source ?? (await downloading(args))
  const db = await openDb(args.db)
  try {
    const n = await importing(db, source, `Importing into ${args.db}`)
    outro(`${n.toLocaleString('en-US')} trials in ${args.db}`)
    return 0
  } finally {
    db.close()
  }
}

async function cacheCommand({ args, rest }: Cli): Promise<number> {
  const [action] = rest
  if (action === undefined) {
    const entries = listCache(args.cache)
    if (entries.length === 0) {
      outro(`Nothing cached in ${args.cache}`)
      return 0
    }
    log.message(
      table(
        entries.map(e => ({
          dataset: e.dataset,
          revision: e.revision.slice(0, 12),
          size: mb(e.bytes),
          complete: e.complete ? 'yes' : 'no (interrupted)',
          downloaded: e.completedAt ?? '',
        })),
      ),
    )
    outro(`${args.cache} · clear it with ${styleText('cyan', 'pnpm replay cache clear')}`)
    return 0
  }

  if (action !== 'clear') {
    log.error(`unknown cache action "${action}"; try: pnpm replay cache, pnpm replay cache clear [--all]`)
    return 2
  }

  const targets = [args.cache, ...(args.all ? [args.db] : [])].filter(path => existsSync(path))
  if (targets.length === 0) {
    outro('Nothing to clear')
    return 0
  }
  if (!args.yes) {
    if (!canAsk()) {
      log.error(`would delete ${targets.join(' and ')}; pass --yes to confirm`)
      return 2
    }
    const sure = await ask(confirm({ message: `Delete ${targets.join(' and ')}?`, initialValue: false }))
    if (!sure) {
      outro('Kept everything')
      return 0
    }
  }

  const freed = clearCache(args.cache)
  if (args.all) {
    for (const path of [args.db, `${args.db}.wal`]) {
      rmSync(path, { force: true })
    }
  }
  outro(`Freed ${mb(freed)} of downloads${args.all ? ` and removed ${args.db}` : ''}`)
  return 0
}

async function casesCommand(args: Args): Promise<number> {
  const db = await openSource(args)
  try {
    const groups = await countCases(db, filterOf(args))
    const total = groups.reduce((sum, g) => sum + Number(g.trials), 0)
    log.message(table(groups))
    outro(`${total.toLocaleString('en-US')} cases in ${groups.length} agent × model groups`)
    return 0
  } finally {
    db.close()
  }
}

async function runCommand(args: Args): Promise<number> {
  const db = await openSource(args)
  try {
    return await runCases(db, args)
  } finally {
    db.close()
  }
}

/** Every case the filter selects (with no filter, the whole dataset), read from db a batch at a time. */
async function runCases(db: Db, args: Args): Promise<number> {
  const filter = filterOf(args)
  const ids = await selectIds(db, filter)
  if (ids.length === 0) {
    cancel('No cases match the filter.')
    return 1
  }

  const id = replayRunId()
  const options = {
    id,
    source: args.source ?? args.db,
    filter,
    out: args.out ?? join('.replay', 'runs', id),
    format: args.format === 'jsonl' ? 'jsonl' : 'parquet',
    concurrency: int(args, 'concurrency'),
    repeat: int(args, 'repeat'),
    maxTurns: args['max-turns'] === undefined ? undefined : int(args, 'max-turns'),
    timeoutMs: int(args, 'timeout'),
    tokensPerSecond: int(args, 'tps'),
    toolUpdates: int(args, 'tool-updates'),
    toolLatencyMs: int(args, 'tool-latency'),
    checkDeterminism: args.checks,
    plugins: await Promise.all(args.plugin.map(loadPlugin)),
    otel: !args['no-otel'],
    events: args.events,
  } as const

  const total = ids.length * options.repeat
  log.step(
    `${ids.length.toLocaleString('en-US')} cases${options.repeat > 1 ? ` × ${options.repeat}` : ''}, concurrency ${options.concurrency} → ${options.out}`,
  )

  const failed: CaseRow[] = []
  // clack's bar takes over Ctrl+C; exit the way an interrupted command should, leaving what was written so far
  const bar = progress({ max: total, style: 'heavy', indicator: 'timer', onCancel: () => process.exit(130) })
  bar.start('Replaying')
  const result = await runSuite(streamCases(db, ids), options, (row, done) => {
    if (!row.ok) {
      failed.push(row)
    }
    bar.advance(
      1,
      `${done.toLocaleString('en-US')} / ${total.toLocaleString('en-US')}${failed.length === 0 ? '' : ` · ${failed.length} failed`}`,
    )
  })

  if (failed.length === 0) {
    bar.stop(`${total.toLocaleString('en-US')} cases passed`)
  } else {
    bar.error(`${failed.length} of ${total.toLocaleString('en-US')} cases failed`)
    for (const row of failed.slice(0, SHOWN_FAILURES)) {
      log.error(failureOf(row))
    }
    if (failed.length > SHOWN_FAILURES) {
      log.warn(`…and ${failed.length - SHOWN_FAILURES} more; see the report`)
    }
  }

  note(summaryOf(result, result.stats), 'Summary')
  outro(`Report: ${styleText('cyan', join(options.out, 'report.md'))}`)
  return failed.length === 0 ? 0 : 1
}

async function shellCommand({ args, rest }: Cli): Promise<number> {
  const db = await openSource(args)
  try {
    const views = await attachRuns(db, args.runs)
    if (rest.length > 0) {
      await run(db, rest.join(' '), text => log.message(text))
      outro('Done')
      return 0
    }

    const runs = views.length === 0 ? `no replay runs under ${args.runs} yet` : `${views.join(', ')} from ${args.runs}`
    log.info(`trials from ${args.source ?? args.db}; ${runs}`)
    await shell(db)
    outro('Bye')
    return 0
  } finally {
    db.close()
  }
}

async function analyzeCommand({ args, rest }: Cli): Promise<number> {
  const dir = rest[0] ?? args.runs
  await analyze(dir, (title, rows) => {
    log.step(title)
    log.message(table(rows))
  })
  outro(`Write your own: ${styleText('cyan', 'pnpm replay:shell')}`)
  return 0
}

/**
 * --source runs from a file without keeping it; otherwise the database, imported from the full Hugging Face dataset
 * the first time it is needed.
 */
async function openSource(args: Args): Promise<Db> {
  if (args.source !== undefined) {
    const db = await openDb()
    await importing(db, args.source, `Loading ${args.source}`)
    return db
  }

  const db = await openDb(args.db)
  if (!(await hasTrials(db))) {
    log.warn(`${args.db} has no trials yet`)
    await importing(db, await downloading(args), `Importing into ${args.db}`)
  }
  return db
}

/** The dataset's parquet files from the cache, downloading only what the current revision is missing. */
async function downloading(args: Args): Promise<string[]> {
  const s = spinner()
  s.start(`Checking ${DATASET}`)
  let bar: ReturnType<typeof progress> | undefined
  let shown = 0

  try {
    const cached = await ensureDataset({
      dir: args.cache,
      onProgress: (done, total) => {
        if (bar === undefined) {
          s.stop(`Downloading ${mb(total)} into ${args.cache}`)
          bar = progress({ max: total, style: 'heavy', onCancel: () => process.exit(130) })
          bar.start('Downloading')
        }
        bar.advance(done - shown, `${mb(done)} / ${mb(total)}`)
        shown = done
      },
    })

    const revision = cached.revision.slice(0, 12)
    if (bar !== undefined) {
      bar.stop(`Downloaded revision ${revision} (${mb(cached.downloaded)})`)
    } else if (cached.offline) {
      s.stop(`Hugging Face unreachable; using cached revision ${revision}`)
    } else {
      s.stop(`Using cached revision ${revision} from ${args.cache}`)
    }
    return cached.files
  } catch (error) {
    ;(bar ?? s).error('Download failed')
    throw error
  }
}

async function importing(db: Db, source: string | string[], message: string): Promise<number> {
  const s = spinner({ indicator: 'timer' })
  s.start(message)
  try {
    const n = await importTrials(db, source)
    s.stop(`${n.toLocaleString('en-US')} trials with steps`)
    return n
  } catch (error) {
    s.error('Import failed')
    throw error
  }
}

/** A module whose default export is a Plugin, or a function that returns one. */
async function loadPlugin(path: string): Promise<Plugin> {
  const mod = (await import(pathToFileURL(resolve(path)).href)) as { default?: unknown }
  const exported = typeof mod.default === 'function' ? (mod.default as () => unknown)() : mod.default
  if (typeof exported !== 'object' || exported === null || typeof (exported as Plugin).name !== 'string') {
    throw new Error(`${path}: the default export must be a plugin (from definePlugin) or a function returning one`)
  }
  return exported as Plugin
}
