// read, edit, and fileTool, which makes a tool from a schema and a Transform. Write is not a tool of its own: `edit`
// with `content` rewrites or creates a file (RFC §12).
//
//   The version a change expects is not in any schema the model sees. The files plugin adds it to the call from what
//   the model has read (withExpected); a call without it expects the file not to exist.

import type { AgentTool, ToolCall, ToolOutput, TSchema } from '@ji.dev/llm'
import type { Hinter } from './hints.ts'
import type { Transform } from './transform.ts'
import type { Expected, Reader, Resolver, Workspace } from './workspace.ts'
import { tool, Type } from '@ji.dev/llm'
import { commit } from './commit.ts'
import { err } from './core/result.ts'
import { decode, view } from './core/view.ts'
import { defaultHinters } from './hints.ts'
import { render } from './render.ts'
import { editTransform, writeTransform } from './transform.ts'
import { FileError } from './workspace.ts'

/** A tool that changes files, waiting for the workspace it works in; the files plugin gives every tool the same one. */
export type FileTool = (workspace: Workspace) => AgentTool

type Args<T extends TSchema> = Parameters<AgentTool<T>['run']>[0]

export interface FileToolSpec<T extends TSchema> {
  name: string
  description: string
  /** Must have a string `path`: the file one call changes. */
  parameters: T
  /** The change one call asks for. Version check, atomic write and the result text are the same for every tool. */
  transform: (args: Args<T>) => Transform
}

export interface EditOptions {
  /** What suggests similar text when an old_text is not found. Default defaultHinters; [] for none. */
  hinters?: readonly Hinter[]
}

/** Lines one read returns when no limit is given. */
const DEFAULT_READ_LINES = 2000

const EXPECTED = 'expected_version'

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

export function fileTool<T extends TSchema>(spec: FileToolSpec<T>): FileTool {
  const { transform, ...declared } = spec
  return workspace =>
    tool({
      ...declared,
      run: async (args, signal) => {
        const { path } = args as { path: string }
        return render(await commit(workspace, path, expectedOf({ arguments: args }), transform(args), signal), path)
      },
    })
}

export function readTool(workspace: Resolver & Reader): AgentTool<typeof readParameters> {
  return tool({
    name: 'read',
    description: 'Read a UTF-8 text file. Long files come in pages: pass offset and limit to read more.',
    parameters: readParameters,
    run: async ({ path, offset = 1, limit = DEFAULT_READ_LINES }, signal) => {
      try {
        const real = await workspace.resolve(path)
        const snapshot = await workspace.read(real, signal)
        if (!snapshot) {
          return failure(`${path} does not exist.`, 'NOT_FOUND')
        }
        const raw = decode(snapshot.bytes)
        if (raw === undefined) {
          return failure(`${path} is not a UTF-8 text file.`, 'UNSUPPORTED_FILE')
        }
        return { text: page(view(raw).text, offset, limit), details: { path: real, version: snapshot.version } }
      } catch (e) {
        // Anything but a FileError is rethrown, so retry middleware sees it
        if (e instanceof FileError) {
          return failure(`${e.message}.`, e.code)
        }
        throw e
      }
    },
  })
}

export function editTool({ hinters = defaultHinters }: EditOptions = {}): FileTool {
  return fileTool({
    name: 'edit',
    description: [
      'Edit a file with replacements against the same original file, or write a whole file with content.',
      'Read the file first. Each old_text must occur exactly count times (default 1).',
      'Edits must not overlap or depend on each other. Copy whitespace and punctuation exactly; only CRLF and LF are treated as equal.',
    ].join(' '),
    parameters: editParameters,
    transform: ({ edits, content }) => {
      if ((edits === undefined) === (content === undefined)) {
        return () => err([{ code: 'INVALID_INPUT', message: 'Pass either edits or content, not both.' }])
      }
      return edits ? editTransform(edits, hinters) : writeTransform(content!)
    },
  })
}

/** The call with the version its file is expected to be at; whatever the model wrote there is replaced. */
export function withExpected(call: ToolCall, expected: Expected): ToolCall {
  return { ...call, arguments: { ...call.arguments, [EXPECTED]: expected } }
}

/** The version withExpected put on a call; 'absent' when there is none. */
export function expectedOf(call: Pick<ToolCall, 'arguments'>): Expected {
  const version: unknown = (call.arguments as Record<string, unknown>)[EXPECTED]
  return typeof version === 'string' ? (version as Expected) : 'absent'
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

function failure(text: string, code: string): ToolOutput {
  return { text, details: { errors: [{ code }] }, isError: true }
}
