// read and edit. Write is not a tool of its own: `edit` with `content` rewrites or creates a file (RFC §12).
//
//   expected_version is not in the schema the model sees. The files plugin sets it from what the model has read; an SDK
//   caller passes it in the arguments directly.

import type { AgentTool, ToolCall, ToolOutput } from '@ji.dev/llm'
import type { Expected, Reader, Store } from './store.ts'
import { resolve } from 'node:path'
import process from 'node:process'
import { tool, Type } from '@ji.dev/llm'
import { commit, editTransform, writeTransform } from './commit.ts'
import { decode, view } from './core/view.ts'
import { render } from './render.ts'
import { StoreError } from './store.ts'

export interface ToolOptions {
  /** Relative paths resolve against this. Default process.cwd(). */
  cwd?: string
}

/** Lines one read returns when no limit is given. */
const DEFAULT_READ_LINES = 2000

const readParameters = Type.Object({
  path: Type.String({ description: 'File path, relative to the workspace or absolute' }),
  offset: Type.Optional(Type.Integer({ minimum: 1, description: 'First line to return, counting from 1' })),
  limit: Type.Optional(
    Type.Integer({ minimum: 1, description: `Most lines to return; default ${DEFAULT_READ_LINES}` }),
  ),
})

const editParameters = Type.Object({
  path: Type.String({ description: 'File path, relative to the workspace or absolute' }),
  edits: Type.Optional(
    Type.Array(
      Type.Object({
        old_text: Type.String({ description: 'Text to replace, copied exactly from the file' }),
        new_text: Type.String({ description: 'Replacement text; empty to delete' }),
        count: Type.Optional(
          Type.Integer({
            minimum: 1,
            description: 'How many times old_text occurs; all of them are replaced. Default 1',
          }),
        ),
      }),
      { minItems: 1, description: 'Replacements, each matched against the file as it was before this call' },
    ),
  ),
  content: Type.Optional(
    Type.String({ description: 'The whole file, to create a new file or rewrite one; instead of edits' }),
  ),
})

export function readTool(reader: Reader, { cwd = process.cwd() }: ToolOptions = {}): AgentTool<typeof readParameters> {
  return tool({
    name: 'read',
    description: 'Read a UTF-8 text file. Long files come in pages: pass offset and limit to read more.',
    parameters: readParameters,
    run: async ({ path, offset = 1, limit = DEFAULT_READ_LINES }, signal) => {
      const absolute = resolve(cwd, path)
      try {
        const snapshot = await reader.read(absolute, signal)
        if (!snapshot) {
          return { text: `${path} does not exist.`, details: { code: 'NOT_FOUND' }, isError: true }
        }
        const raw = decode(snapshot.bytes)
        if (raw === undefined) {
          return { text: `${path} is not a UTF-8 text file.`, details: { code: 'UNSUPPORTED_FILE' }, isError: true }
        }
        return { text: page(view(raw).text, offset, limit), details: { path: absolute, version: snapshot.version } }
      } catch (e) {
        return storeFailure(e)
      }
    },
  })
}

export function editTool(store: Store, { cwd = process.cwd() }: ToolOptions = {}): AgentTool<typeof editParameters> {
  return tool({
    name: 'edit',
    description: [
      'Edit a file with replacements against the same original file, or write a whole file with content.',
      'Read the file first. Each old_text must occur exactly count times (default 1).',
      'Edits must not overlap or depend on each other. Copy whitespace and punctuation exactly; only CRLF and LF are treated as equal.',
    ].join(' '),
    parameters: editParameters,
    run: async (args, signal) => {
      const { path, edits, content } = args
      const absolute = resolve(cwd, path)
      if ((edits === undefined) === (content === undefined)) {
        return failure(path, 'Pass either edits or content, not both.', 'INVALID_INPUT')
      }

      const version = (args as { expected_version?: unknown }).expected_version
      const expected = typeof version === 'string' ? (version as Expected) : undefined
      if (edits && expected === undefined) {
        return failure(path, `Read ${path} before editing it.`, 'NOT_OBSERVED')
      }

      try {
        const f = edits ? editTransform(edits) : writeTransform(content!)
        const outcome = await commit(store, absolute, expected ?? 'absent', f, signal)
        return render(outcome, path, edits ? 'edit' : 'write')
      } catch (e) {
        return storeFailure(e)
      }
    },
  })
}

/** The path of a read or edit call, resolved: what the files plugin keys versions by. */
export function pathOf(call: ToolCall, cwd: string): string | undefined {
  const path: unknown = call.arguments.path
  return (call.name === 'read' || call.name === 'edit') && typeof path === 'string' ? resolve(cwd, path) : undefined
}

function page(text: string, offset: number, limit: number): string {
  if (text === '') {
    return '(empty file)'
  }
  const lines = (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n')
  if (offset > lines.length) {
    return `(no line ${offset}; the file has ${lines.length} lines)`
  }
  const shown = lines.slice(offset - 1, offset - 1 + limit)
  const last = offset - 1 + shown.length
  const whole = offset === 1 && last === lines.length
  return whole ? text : `${shown.join('\n')}\n\n[lines ${offset}-${last} of ${lines.length}; pass offset to read more]`
}

function failure(path: string, text: string, code: string): ToolOutput {
  return {
    text: `Edit failed; ${path} is unchanged.\n${text}`,
    details: { commit_state: 'not_applied', errors: [{ code }] },
    isError: true,
  }
}

/** StoreError is for the model; anything else is rethrown, so retry middleware sees it. Nothing was written either way. */
function storeFailure(e: unknown): ToolOutput {
  if (e instanceof StoreError) {
    return {
      text: `${e.message}.`,
      details: { commit_state: 'not_applied', errors: [{ code: e.code, message: e.message }] },
      isError: true,
    }
  }
  throw e
}
