// bash and grep: each is a schema, a command and a Fold; clocks and stopping are the executor's, bounded memory is
// foldStream's (RFC §5.4). Both are plain objects: to change a field, spread one and override it. Neither tool decides
// what may be run or searched: asking is the approval plugin's, and limiting what a command can touch is the
// executor's (X13).

import type { AgentTool } from '@ji.dev/llm'
import type { Outcome } from './core/fold.ts'
import type { Budget } from './core/output.ts'
import type { Clip } from './core/window.ts'
import type { CommandExecutor, Log } from './executor.ts'
import { tool, Type } from '@ji.dev/llm'
import { createOutputFold } from './core/output.ts'
import { failure, renderFound, renderOutput } from './core/render.ts'
import { createHitsFold, ripgrepArgs } from './core/ripgrep.ts'
import { omittedLines } from './core/window.ts'
import { CommandNotFoundError } from './executor.ts'
import { foldStream, streamResult, tapStream } from './stream.ts'

export const BASH = 'bash'
const GREP = 'grep'

export interface BashOptions {
  /** What the model is told about the tool. The default is true of createLocalExecutor. */
  description?: string
  /** Total time one command may take when the model gives none, and the most it may ask for. Default 120 and 600. */
  timeoutSeconds?: { default: number; max: number }
  /** Stop a command that writes nothing for this long. Default: off. */
  idleMs?: number
  /** Default: the first 40 and last 160 lines, 400 characters of each. */
  budget?: Budget
  /** Keeps the whole output of a command whose result leaves lines out. Default: nowhere. */
  log?: () => Log
}

export interface GrepOptions {
  /** What the model is told about the tool. */
  description?: string
  /** The ripgrep to run. Default 'rg', found on the executor's PATH. */
  rg?: readonly string[]
  /** Matching lines returned when the model gives no limit. Default 100. */
  limit?: number
  /** Default 30 seconds. */
  timeoutMs?: number
  /** Characters kept of one line. Default 300. */
  lineChars?: number
}

const DEFAULT_BUDGET: Budget = { headLines: 40, tailLines: 160, lineChars: 400 }

const MAX_CONTEXT = 10

const BASH_DESCRIPTION = [
  'Run a shell command and get its output and exit code.',
  'Every call starts a new shell: cd and variables do not carry over, and nothing keeps running after it.',
  'Long output keeps its first and last lines. Use grep to search file contents, not this.',
].join(' ')

const GREP_DESCRIPTION = [
  'Search file contents with ripgrep. Returns matching lines as path:line: text.',
  'Hidden files are searched; files ignored by .gitignore are not.',
].join(' ')

/** Not in the tool description: it is sent with every request, and only true on some machines (RFC §5.4). */
const NO_RIPGREP = [
  'ripgrep (rg) is not installed here, so this tool cannot search.',
  `Search with bash instead: grep -rnE 'pattern' path, or grep -rnF for plain text; find path -name 'glob' lists files.`,
].join(' ')

const bashParameters = Type.Object({
  command: Type.String({ description: 'One command line, run by bash in the workspace root' }),
  timeout_seconds: Type.Optional(
    Type.Integer({ minimum: 1, description: 'The most it may take in all; past the maximum, the maximum is used' }),
  ),
})

const grepParameters = Type.Object({
  pattern: Type.String({ description: 'A regular expression; plain text when literal is true' }),
  path: Type.Optional(Type.String({ description: 'File or directory to search; default the workspace root' })),
  glob: Type.Optional(Type.String({ description: 'Only files that match it, e.g. *.ts or !*.test.ts' })),
  literal: Type.Optional(Type.Boolean({ description: 'Match the pattern as plain text. Default false' })),
  ignore_case: Type.Optional(Type.Boolean({ description: 'Default false' })),
  context: Type.Optional(
    Type.Integer({ minimum: 0, maximum: MAX_CONTEXT, description: 'Lines shown before and after each matching line' }),
  ),
  limit: Type.Optional(Type.Integer({ minimum: 1, description: 'Most matching lines returned; default 100' })),
})

/** Every chunk is yielded as it arrives, so the run shows it as a tool_update. */
export function createBashTool(executor: CommandExecutor, options: BashOptions = {}): AgentTool<typeof bashParameters> {
  const {
    description = BASH_DESCRIPTION,
    timeoutSeconds = { default: 120, max: 600 },
    idleMs,
    budget = DEFAULT_BUDGET,
    log: openLog,
  } = options

  return tool({
    name: BASH,
    description,
    parameters: bashParameters,
    async *run({ command, timeout_seconds = timeoutSeconds.default }, signal) {
      const timeoutMs = Math.min(timeout_seconds, timeoutSeconds.max) * 1000
      const fold = createOutputFold(budget)
      const log = openLog?.()
      const started = performance.now()

      let ended: [Clip, Outcome] | undefined
      let logFile: string | undefined
      try {
        const output = executor.execute(command, { signal, timeoutMs, idleMs })
        const [out, outcome] = yield* foldStream(
          tapStream(output, chunk => log?.write(chunk.text)),
          fold,
        )
        ended = [fold.close(out), outcome!]
      } finally {
        // A cancelled command leaves no log behind; a finished one keeps it only when its result leaves lines out
        logFile = await log?.close(ended !== undefined && omittedLines(ended[0]) > 0)
      }

      const [clip, outcome] = ended
      return renderOutput(clip, outcome, performance.now() - started, logFile)
    },
  })
}

/** ripgrep's exit code is read here, so the model never has to know it: 1 is no matches, 2 is a failure. */
export function createGrepTool(executor: CommandExecutor, options: GrepOptions = {}): AgentTool<typeof grepParameters> {
  const {
    description = GREP_DESCRIPTION,
    rg = ['rg'],
    limit: defaultLimit = 100,
    timeoutMs = 30_000,
    lineChars = 300,
  } = options

  return tool({
    name: GREP,
    description,
    parameters: grepParameters,
    async run({ pattern, path = '.', glob, literal, ignore_case, context, limit = defaultLimit }, signal) {
      const argv = [...rg, ...ripgrepArgs({ pattern, path, glob, literal, ignoreCase: ignore_case, context })]
      // An array, so no shell reads what the model wrote (X1)
      const search = foldStream(executor.execute(argv, { signal, timeoutMs }), createHitsFold(limit, lineChars))

      const searched = await streamResult(search).catch(whenNotFound)
      if (searched === undefined) {
        return failure(NO_RIPGREP, 'NO_RIPGREP')
      }

      const [found, outcome] = searched
      // undefined: the fold had enough and closed the stream
      if (outcome === undefined || (outcome.kind === 'exit' && outcome.code <= 1)) {
        return renderFound(found, limit)
      }
      if (outcome.kind === 'timeout') {
        return failure(
          `The search took more than ${timeoutMs / 1000}s and was stopped. Narrow the path or glob.`,
          'TIMEOUT',
        )
      }
      return failure(found.stderr.trim() || 'ripgrep failed.', 'SEARCH_FAILED')
    },
  })
}

/** undefined when the executable does not exist; anything else is rethrown, so retry middleware sees it. */
function whenNotFound(error: unknown): undefined {
  if (error instanceof CommandNotFoundError) {
    return undefined
  }
  throw error
}
