// files: the read tool, the tools that change files, and the ledger of what the model has read (RFC §5.5). The ledger
// is plugin state, so it is saved, replayed, forked and rolled back with the session. Approval is not here: `preview`
// says what a call would change, in the shape an approval plugin takes, and the two plugins never import each other.

import type { Plugin, ToolCall, ToolResultMessage } from '@ji.dev/llm'
import type { FileTool } from './tools.ts'
import type { Transform } from './transform.ts'
import type { Expected, Workspace } from './workspace.ts'
import { callsOf, definePlugin, toolError } from '@ji.dev/llm'
import { prepare } from './commit.ts'
import { err } from './core/result.ts'
import { diff, render, summary } from './render.ts'
import { agentTool, editTool, expectedOf, readTool, withApproved, withExpected } from './tools.ts'

export interface Ledger {
  /** File identity (workspace.resolve) to the version the model last read or wrote. */
  versions: Record<string, string>
}

export interface FilesOptions {
  /** The tools that change files. Default: editTool(). `read` is always there. */
  tools?: readonly FileTool[]
}

export interface FilesPlugin extends Plugin<Ledger> {
  /**
   * What a call is about to change, before anything is written; give it to the choices plugin:
   *
   *     choices({ answer, approve: [fileTools.preview] })
   *
   * undefined for a call that changes no file (read, other plugins' tools). The tool's own failure for a change it
   * would refuse, so nobody is asked about it. Otherwise the change, with `call` writing exactly the text shown, or
   * nothing when the file has changed since. Works only inside a toolCall hook: only there does the call carry the
   * version the file is expected to be at.
   */
  preview: (call: ToolCall, signal: AbortSignal) => Promise<ChangePreview | ToolResultMessage | undefined>
}

export interface ChangePreview {
  /** `Edit src/a.ts (+2 -1)` or `Create src/a.ts (12 lines)`. */
  title: string
  /** The diff. */
  detail: string
  /** The call with the new text fixed on it. */
  call: ToolCall
}

/**
 * Every call that changes a file expects the version in the ledger; a file the ledger does not have is expected not to
 * exist, so an unread file is never overwritten. Calls on one file run in order, each expecting the version the
 * previous one wrote; calls on different files still run at once.
 */
export function files(workspace: Workspace, { tools = [editTool()] }: FilesOptions = {}): FilesPlugin {
  const read = readTool(workspace)
  const changing = new Map(tools.map(t => [t.name, t]))
  const own = new Set([read.name, ...changing.keys()])

  /** The identity of the file a call is about; undefined for other tools and for paths the tool itself will refuse. */
  async function fileOf(call: ToolCall): Promise<string | undefined> {
    const path: unknown = call.arguments.path
    return own.has(call.name) && typeof path === 'string' ? workspace.resolve(path).catch(() => undefined) : undefined
  }

  const plugin = definePlugin<Ledger>({
    name: 'files',
    tools: [read, ...tools.map(t => agentTool(workspace, t))],
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
          changing.has(calls[i].name)
            ? withExpected(calls[i], (versions.get(file[i] ?? '') ?? 'absent') as Expected)
            : calls[i],
        )
        const out = yield* next({ ...message, content: run })
        wave.forEach((i, k) => {
          results[i] = out[k]
          // Only a write moves the expected version within a turn: the model wrote this turn's changes before it saw
          // what this turn's reads return
          for (const [path, version] of Object.entries(observed([out[k]], changing))) {
            versions.set(path, version)
          }
        })
      }
      return results
    },
  })

  return {
    ...plugin,
    async preview(call, signal) {
      const spec = changing.get(call.name)
      if (!spec) {
        return undefined
      }
      // A hook sees the arguments before the tool's schema has checked them, so anything they break is an error here
      const path: unknown = call.arguments.path
      const change: Transform = text => {
        try {
          return spec.transform(call.arguments)(text)
        } catch {
          return err([{ code: 'INVALID_INPUT', message: `The arguments do not fit ${spec.name}.` }])
        }
      }
      const prepared =
        typeof path === 'string'
          ? await prepare(workspace, path, expectedOf(call), change, signal)
          : err([{ code: 'INVALID_INPUT' as const, message: 'path must be a string.' }])

      if (!prepared.ok) {
        // Not left to the tool: it gets the arguments after the schema has checked them, and could decide otherwise
        const { text, details } = render(prepared, String(path))
        return { ...toolError(call, text), details }
      }
      return {
        title: summary(prepared.value, String(path)),
        detail: diff(prepared.value),
        call: withApproved(call, prepared.value.next),
      }
    },
  }
}

/** File identity to version, from the successful results of these tools. */
function observed(
  results: readonly ToolResultMessage[],
  tools: { has: (name: string) => boolean },
): Record<string, string> {
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
