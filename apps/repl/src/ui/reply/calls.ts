// A tool call and its result as the two views show them. Every row is cut to fit, so a long one never wraps under
// the rail.

import type { ToolCall, ToolResultMessage } from '@ji.dev/llm'
import { styleText } from 'node:util'
import { highlight, languageOf } from '../paint/highlight.ts'
import { clip, dim, fit, room, widthOf } from '../paint/text.ts'

/** The rows of a file read the full view shows; the rest are counted. */
const READ_ROWS = 30

/** The full view's call: its name, then an argument a row. */
export function describeArguments(call: ToolCall): string {
  const args = Object.entries(call.arguments).map(([key, value]) => {
    const label = dim(`${key}:`)
    return `${label} ${clip(JSON.stringify(value), room() - widthOf(label) - 1)}`
  })
  return [styleText('bold', call.name), ...args].join('\n')
}

/**
 * The full view's result: dim tool name and normal-colored result (red on error), to stand apart from the dim
 * thinking; a file read shows its first lines, numbered and in color.
 */
export async function describeResult(call: ToolCall, result: ToolResultMessage): Promise<string> {
  const name = dim(result.toolName)
  const { path, offset } = call.arguments
  if (result.isError || call.name !== 'read' || typeof path !== 'string') {
    const body = clip(resultText(result), room() - widthOf(name) - 2)
    return `${name}  ${result.isError ? styleText('red', body) : body}`
  }

  // Tabs are as wide as the terminal says, which no clipping can know
  const lines = resultText(result).replaceAll('\t', '  ').split('\n')
  const shown = await highlight(lines.slice(0, READ_ROWS).join('\n'), languageOf(path))
  const first = typeof offset === 'number' ? offset : 1
  const digits = String(first + shown.length - 1).length
  const numbered = shown.map(
    (line, i) => `${dim(String(first + i).padStart(digits))}  ${fit(line, room() - digits - 2)}`,
  )

  const rest = lines.length - shown.length
  return [name, ...numbered, ...(rest > 0 ? [dim(`… ${rest} more lines`)] : [])].join('\n')
}

/** The brief view's one row for a call: the call itself, and on error what went wrong, since that matters. */
export function describeDone(call: ToolCall, result: ToolResultMessage): string {
  if (!result.isError) {
    return describeCall(call)
  }

  // The error keeps at least half the row, and gives what it does not need to the call
  const width = room()
  const error = clip(resultText(result), Number.POSITIVE_INFINITY)
  const head = describeCall(call, Math.max(width - widthOf(error) - 2, Math.floor(width / 2)))
  return `${head}  ${styleText('red', clip(error, width - widthOf(head) - 2))}`
}

function resultText(result: ToolResultMessage): string {
  return result.content.map(c => (c.type === 'text' ? c.text : `[${c.type}]`)).join('')
}

/** Formats as a call on one row: calc(expr: "17*23"), its arguments cut to fit `width`. */
function describeCall(call: ToolCall, width = room()): string {
  const args = Object.entries(call.arguments)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join(', ')
  // The name and the two parentheses take columns of their own
  return `${styleText('bold', call.name)}${dim('(')}${clip(args, width - widthOf(call.name) - 2)}${dim(')')}`
}
