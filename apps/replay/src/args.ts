// The command line as data: parse(argv) -> { command, rest, args }. The interactive wizard builds an argv too, so a
// run started either way goes down the same path, and the wizard can print the command that repeats it.

import type { CaseFilter } from './testkit.ts'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { DEFAULT_CACHE } from './cache.ts'
import { DEFAULT_DB } from './dataset.ts'

const OPTIONS = {
  source: { type: 'string' },
  db: { type: 'string', default: DEFAULT_DB },
  agent: { type: 'string' },
  model: { type: 'string' },
  task: { type: 'string' },
  id: { type: 'string' },
  reward: { type: 'string' },
  'min-steps': { type: 'string' },
  'max-steps': { type: 'string' },
  'min-tool-calls': { type: 'string' },
  'max-tool-calls': { type: 'string' },
  where: { type: 'string' },
  limit: { type: 'string' },
  seed: { type: 'string' },
  concurrency: { type: 'string', default: '4' },
  repeat: { type: 'string', default: '1' },
  'max-turns': { type: 'string' },
  tps: { type: 'string', default: '0' },
  'tool-updates': { type: 'string', default: '0' },
  'tool-latency': { type: 'string', default: '0' },
  timeout: { type: 'string', default: '60000' },
  format: { type: 'string', default: 'parquet' },
  out: { type: 'string' },
  'no-otel': { type: 'boolean', default: false },
  events: { type: 'boolean', default: false },
  checks: { type: 'boolean', default: false },
  plugin: { type: 'string', multiple: true, default: [] as string[] },
  runs: { type: 'string', default: join('.replay', 'runs') },
  cache: { type: 'string', default: DEFAULT_CACHE },
  all: { type: 'boolean', default: false },
  yes: { type: 'boolean', default: false },
} as const

export interface Cli {
  command: string | undefined
  rest: string[]
  args: Args
}

export type Args = ReturnType<typeof parseArgv>['values']

export function parse(argv: string[]): Cli {
  const { values, positionals } = parseArgv(argv)
  const [command, ...rest] = positionals
  return { command, rest, args: values }
}

// eslint-disable-next-line ts/explicit-function-return-type -- the type is what parseArgs infers from OPTIONS
function parseArgv(argv: string[]) {
  return parseArgs({ args: argv, allowPositionals: true, options: OPTIONS })
}

export function filterOf(args: Args): CaseFilter {
  const list = (s: string | undefined): string[] | undefined =>
    s
      ?.split(',')
      .map(x => x.trim())
      .filter(Boolean)
  const num = (name: keyof Args): number | undefined => (args[name] === undefined ? undefined : int(args, name))

  const filter: CaseFilter = {
    agent: list(args.agent),
    model: list(args.model),
    task: list(args.task),
    id: list(args.id),
    reward: args.reward === undefined ? undefined : args.reward === '1' ? 1 : 0,
    minSteps: num('min-steps'),
    maxSteps: num('max-steps'),
    minToolCalls: num('min-tool-calls'),
    maxToolCalls: num('max-tool-calls'),
    where: args.where,
    limit: num('limit'),
    seed: num('seed'),
  }
  return Object.fromEntries(Object.entries(filter).filter(([, v]) => v !== undefined)) as CaseFilter
}

export function int(args: Args, name: keyof Args): number {
  const raw = args[name]
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`--${name} must be a whole number, got ${String(raw)}`)
  }
  return n
}

/** argv as a command to paste into a shell. */
export function commandLine(argv: string[]): string {
  const quote = (a: string): string => (/^[\w./:=,@-]+$/.test(a) ? a : `'${a.replaceAll(`'`, `'\\''`)}'`)
  return ['pnpm replay', ...argv.map(quote)].join(' ')
}
