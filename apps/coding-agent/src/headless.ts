// The coding agent without a terminal: one task in, its answer out, for a benchmark runner (rfcs/bench-gap).
//
//   node src/headless.ts [options] [task]
//
//   The task is the argument, or stdin without one. The answer goes to stdout, progress to stderr, and the exit code
//   says how it went: 0 done, 1 the run failed (timed out, aborted, the provider, too many steps), 2 a bad invocation.
//
//   --model provider/id   pi-ai's catalog; the key comes from the provider's environment variable (default: deepseek)
//   --base-url url        send the model's calls to another endpoint, an OpenAI-compatible proxy say
//   --thinking level      off, minimal, low, medium, high, xhigh (default: high)
//   --root dir            where the files are and commands run (default: the current directory)
//   --log file            every event of the run, one JSON line each, appended
//   --timeout seconds     wall-clock limit on the whole run
//   --max-steps n         steps before the run gives up (default: 200)
//   --quiet               no progress on stderr

import type { AnyPlugin, Api, Model, RunEvent, ThinkingLevel, ToolCall } from '@ji.dev/llm'
import type { TaskOptions, TaskOutcome } from './headless/task.ts'
import { closeSync, openSync, readFileSync, writeSync } from 'node:fs'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { definePlugin, findModel, UnsupportedThinkingError } from '@ji.dev/llm'
import { jsonl } from '@ji.dev/plugin-jsonl'
import { runTask } from './headless/task.ts'

const USAGE =
  'usage: headless [--model provider/id] [--base-url url] [--thinking level] [--root dir] [--log file] [--timeout seconds] [--max-steps n] [--quiet] [task]'

const options = {
  model: { type: 'string', default: 'deepseek/deepseek-v4-flash' },
  'base-url': { type: 'string' },
  thinking: { type: 'string', default: 'high' },
  root: { type: 'string', default: process.env.INIT_CWD ?? process.cwd() },
  log: { type: 'string' },
  timeout: { type: 'string' },
  'max-steps': { type: 'string' },
  quiet: { type: 'boolean', default: false },
} as const

main(process.argv.slice(2)).then(code => {
  process.exitCode = code
})

/** The task from the arguments, and what closes the log once the run ends. */
interface Config {
  task: TaskOptions
  close: () => void
}

async function main(argv: string[]): Promise<number> {
  let config: Config
  try {
    config = configure(argv)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${USAGE}\n`)
    return 2
  }
  const { task, close } = config

  const stopping = new AbortController()
  const stop = (signal: string): void => stopping.abort(new Error(`stopped by ${signal}`))
  process.once('SIGINT', () => stop('SIGINT'))
  process.once('SIGTERM', () => stop('SIGTERM'))

  try {
    const outcome = await runTask({ ...task, signal: stopping.signal })
    return report(outcome)
  } finally {
    close()
  }
}

/** Throws on a bad invocation. */
function configure(argv: string[]): Config {
  const { values, positionals } = parseArgs({ args: argv, options, allowPositionals: true })
  if (positionals.length > 1) {
    throw new Error('one task at most')
  }

  const task = positionals[0] ?? readFileSync(process.stdin.fd, 'utf8')
  if (task.trim() === '') {
    throw new Error('the task is empty')
  }

  const model = modelOf(values.model, values['base-url'])
  const thinking = values.thinking as ThinkingLevel
  checkModel(model, thinking)

  const log = values.log === undefined ? undefined : openSync(values.log, 'a')
  const plugins: AnyPlugin[] = []
  if (log !== undefined) {
    plugins.push(jsonl(line => writeSync(log, `${line}\n`)))
  }
  if (!values.quiet) {
    plugins.push(progress(line => process.stderr.write(`${line}\n`)))
  }

  return {
    task: {
      root: values.root,
      task,
      model,
      thinking,
      timeoutMs: seconds(values.timeout, 'timeout'),
      maxSteps: integer(values['max-steps'], 'max-steps'),
      plugins,
    },
    close: () => {
      if (log !== undefined) {
        closeSync(log)
      }
    },
  }
}

/** The catalog's model, sent elsewhere when a base URL is given. */
function modelOf(spec: string, baseUrl: string | undefined): string | Model<Api> {
  return baseUrl === undefined ? spec : { ...findModel(spec), baseUrl }
}

/** A typo in the model or the level stops the run before it starts, with the choices listed. */
function checkModel(model: string | Model<Api>, thinking: ThinkingLevel): void {
  const spec = typeof model === 'string' ? model : `${model.provider}/${model.id}`
  const info = findModel(spec)

  if (!info.thinkingLevels.includes(thinking)) {
    throw new UnsupportedThinkingError(info, thinking)
  }
}

function seconds(value: string | undefined, name: string): number | undefined {
  const n = integer(value, name)
  return n === undefined ? undefined : n * 1000
}

function integer(value: string | undefined, name: string): number | undefined {
  if (value === undefined) {
    return undefined
  }

  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`--${name} takes a positive integer, not "${value}"`)
  }

  return n
}

/** The answer on stdout, the rest on stderr. */
function report(outcome: TaskOutcome): number {
  const { summary } = outcome
  const usage = `${summary.turns} turns · ${summary.usage.input} in, ${summary.usage.output} out · $${summary.usage.cost.toFixed(4)}`

  if (outcome.outcome === 'done') {
    process.stdout.write(`${outcome.text}\n`)
    process.stderr.write(`done · ${usage} · session ${outcome.session}\n`)
    return 0
  }

  process.stderr.write(
    `failed (${outcome.error.kind}): ${outcome.error.message}\n${usage} · session ${outcome.session}\n`,
  )
  return 1
}

/** One line per model turn and tool call, enough to follow a run from its log. */
function progress(write: (line: string) => void): AnyPlugin {
  return definePlugin({
    name: 'progress',
    observe: (e: RunEvent) => {
      const line = lineOf(e)
      if (line !== undefined) {
        write(line)
      }
    },
  })
}

function lineOf(e: RunEvent): string | undefined {
  switch (e.type) {
    case 'tool_start':
      return `[${e.t}] ${callLine(e.call)}`
    case 'tool_end':
      return `[${e.t}] ${e.call.name} ${e.result.isError ? 'failed' : 'ok'} in ${Math.round(e.ms)}ms`
    case 'model_error':
      return `[${e.t}] model error: ${e.error.message}`
    case 'compaction:end':
      return `[${e.t}] compacted ${e.before} → ${e.after} tokens${e.error === undefined ? '' : ` (${e.error})`}`
    case 'step_cancelled':
      return `[${e.t}] step cancelled: ${e.reason}`
    default:
      return undefined
  }
}

function callLine(call: ToolCall): string {
  const args = JSON.stringify(call.arguments)
  const shown = args.length > 160 ? `${args.slice(0, 160)}…` : args
  return `${call.name} ${shown}`
}
