// files: the read and edit tools plus the ledger of what the model has read (RFC §5.6). The ledger is plugin state, so
// it is saved, replayed, forked and rolled back with the session. matchHints adds read-only candidates when an
// old_text is not found.

import type { Plugin, ToolCall, ToolResultMessage } from '@ji.dev/llm'
import type { Hinter } from './hints.ts'
import type { Reader, Store } from './store.ts'
import type { ToolOptions } from './tools.ts'
import { resolve } from 'node:path'
import process from 'node:process'
import { callsOf, definePlugin } from '@ji.dev/llm'
import { decode, view } from './core/view.ts'
import { defaultHinters } from './hints.ts'
import { editTool, pathOf, readTool } from './tools.ts'

export interface Ledger {
  /** Absolute path to the version the model last read or wrote. */
  versions: Record<string, string>
}

/**
 * Every edit call gets expected_version from the ledger; whatever the model wrote there is replaced. Calls on one path
 * run in order, each edit expecting the version the previous one wrote; calls on different paths still run at once.
 */
export function files(store: Store, { cwd = process.cwd() }: ToolOptions = {}): Plugin<Ledger> {
  return definePlugin<Ledger>({
    name: 'files',
    tools: [readTool(store, { cwd }), editTool(store, { cwd })],
    state: {
      init: { versions: {} },
      reduce: (own, turn) =>
        turn.kind === 'model' ? { versions: { ...own.versions, ...observed(turn.results) } } : own,
    },
    async *toolCalls(message, next, ctx) {
      const calls = callsOf(message)

      // Wave k holds the k-th call of every path; calls on no path go in the first wave
      const waves: number[][] = []
      const seen = new Map<string, number>()
      calls.forEach((call, i) => {
        const path = pathOf(call, cwd)
        const wave = path === undefined ? 0 : (seen.get(path) ?? 0)
        if (path !== undefined) {
          seen.set(path, wave + 1)
        }
        ;(waves[wave] ??= []).push(i)
      })

      const versions = new Map(Object.entries(ctx.own.versions))
      const results: ToolResultMessage[] = []
      for (const wave of waves) {
        const run = wave.map(i => withVersion(calls[i], versions, cwd))
        const out = yield* next({ ...message, content: run })
        wave.forEach((i, k) => {
          results[i] = out[k]
          // Only a write moves the expected version within a turn: the model wrote this turn's edits before it saw
          // what this turn's reads return
          const written = out[k].toolName === 'edit' ? observed([out[k]]) : {}
          for (const [path, version] of Object.entries(written)) {
            versions.set(path, version)
          }
        })
      }
      return results
    },
  })
}

export interface HintOptions extends ToolOptions {
  hinters?: Hinter[]
}

/** After an edit whose old_text was not found, lists similar text in the file. Nothing is applied. */
export function matchHints(
  reader: Reader,
  { cwd = process.cwd(), hinters = defaultHinters }: HintOptions = {},
): Plugin {
  return definePlugin({
    name: 'match-hints',
    async *toolCall(call, next, ctx) {
      const result = yield* next(call)
      const misses = notFound(call, result)
      if (misses.length === 0) {
        return result
      }

      const snapshot = await reader.read(resolve(cwd, String(call.arguments.path)), ctx.signal).catch(() => undefined)
      const raw = snapshot && decode(snapshot.bytes)
      if (raw === undefined) {
        return result
      }

      const text = view(raw).text
      const lines: string[] = []
      for (const { edit, old_text } of misses) {
        const reported = new Set<number>()
        for (const hint of hinters.flatMap(h => h(text, old_text))) {
          if (!reported.has(hint.line)) {
            reported.add(hint.line)
            lines.push(`  edits[${edit}], line ${hint.line}: ${hint.reason}`)
          }
        }
      }
      if (lines.length === 0) {
        return result
      }

      const hint = `Similar text (not applied):\n${lines.join('\n')}\nRead those lines and copy them exactly.`
      return { ...result, content: [...result.content, { type: 'text', text: hint }] }
    },
  })
}

/** Path to version, from successful read and edit results. */
function observed(results: readonly ToolResultMessage[]): Record<string, string> {
  const versions: Record<string, string> = {}
  for (const r of results) {
    const details = r.details as { path?: unknown; version?: unknown } | undefined
    if (
      (r.toolName === 'read' || r.toolName === 'edit') &&
      !r.isError &&
      typeof details?.path === 'string' &&
      typeof details.version === 'string'
    ) {
      versions[details.path] = details.version
    }
  }
  return versions
}

function withVersion(call: ToolCall, versions: ReadonlyMap<string, string>, cwd: string): ToolCall {
  if (call.name !== 'edit') {
    return call
  }
  const { expected_version: _fromModel, ...args } = call.arguments
  const version = versions.get(pathOf(call, cwd) ?? '')
  return { ...call, arguments: version === undefined ? args : { ...args, expected_version: version } }
}

/** The edits of a failed edit call whose old_text occurs nowhere. */
function notFound(call: ToolCall, result: ToolResultMessage): { edit: number; old_text: string }[] {
  if (call.name !== 'edit' || !result.isError) {
    return []
  }
  const errors =
    (result.details as { errors?: { code: string; edit?: number; found?: number }[] } | undefined)?.errors ?? []
  const edits = call.arguments.edits as { old_text?: unknown }[] | undefined
  return errors.flatMap(e => {
    const old_text = e.edit === undefined ? undefined : edits?.[e.edit]?.old_text
    return e.code === 'MATCH_COUNT' && e.found === 0 && typeof old_text === 'string'
      ? [{ edit: e.edit!, old_text }]
      : []
  })
}
