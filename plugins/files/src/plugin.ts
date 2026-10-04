// files: the read tool, the tools that change files, and the ledger of what the model has read (RFC §5.5). The ledger
// is plugin state, so it is saved, replayed, forked and rolled back with the session.

import type { Plugin, ToolCall, ToolResultMessage } from '@ji.dev/llm'
import type { FileTool } from './tools.ts'
import type { Expected, Workspace } from './workspace.ts'
import { callsOf, definePlugin } from '@ji.dev/llm'
import { editTool, readTool, withExpected } from './tools.ts'

export interface Ledger {
  /** File identity (workspace.resolve) to the version the model last read or wrote. */
  versions: Record<string, string>
}

export interface FilesOptions {
  /** The tools that change files. Default: editTool(). `read` is always there. */
  tools?: readonly FileTool[]
}

/**
 * Every call that changes a file expects the version in the ledger; a file the ledger does not have is expected not to
 * exist, so an unread file is never overwritten. Calls on one file run in order, each expecting the version the
 * previous one wrote; calls on different files still run at once.
 */
export function files(workspace: Workspace, { tools = [editTool()] }: FilesOptions = {}): Plugin<Ledger> {
  const read = readTool(workspace)
  const writers = tools.map(make => make(workspace))
  const writes = new Set(writers.map(t => t.name))
  const own = new Set([read.name, ...writes])

  /** The identity of the file a call is about; undefined for other tools and for paths the tool itself will refuse. */
  async function fileOf(call: ToolCall): Promise<string | undefined> {
    const path: unknown = call.arguments.path
    return own.has(call.name) && typeof path === 'string' ? workspace.resolve(path).catch(() => undefined) : undefined
  }

  return definePlugin<Ledger>({
    name: 'files',
    tools: [read, ...writers],
    state: {
      init: { versions: {} },
      reduce: (ledger, turn) =>
        turn.kind === 'model' ? { versions: { ...ledger.versions, ...observed(turn.results, own) } } : ledger,
    },
    async *toolCalls(message, next, ctx) {
      const calls = callsOf(message)
      const file = await Promise.all(calls.map(fileOf))

      // Wave k holds the k-th call of every file; calls on no file go in the first wave
      const waves: number[][] = []
      const seen = new Map<string, number>()
      file.forEach((path, i) => {
        const wave = path === undefined ? 0 : (seen.get(path) ?? 0)
        if (path !== undefined) {
          seen.set(path, wave + 1)
        }
        ;(waves[wave] ??= []).push(i)
      })

      const versions = new Map(Object.entries(ctx.own.versions))
      const results: ToolResultMessage[] = []
      for (const wave of waves) {
        const run = wave.map(i =>
          writes.has(calls[i].name)
            ? withExpected(calls[i], (versions.get(file[i] ?? '') ?? 'absent') as Expected)
            : calls[i],
        )
        const out = yield* next({ ...message, content: run })
        wave.forEach((i, k) => {
          results[i] = out[k]
          // Only a write moves the expected version within a turn: the model wrote this turn's changes before it saw
          // what this turn's reads return
          for (const [path, version] of Object.entries(observed([out[k]], writes))) {
            versions.set(path, version)
          }
        })
      }
      return results
    },
  })
}

/** File identity to version, from the successful results of these tools. */
function observed(results: readonly ToolResultMessage[], tools: ReadonlySet<string>): Record<string, string> {
  const versions: Record<string, string> = {}
  for (const r of results) {
    const details = r.details as { path?: unknown; version?: unknown } | undefined
    if (
      tools.has(r.toolName) &&
      !r.isError &&
      typeof details?.path === 'string' &&
      typeof details.version === 'string'
    ) {
      versions[details.path] = details.version
    }
  }
  return versions
}
