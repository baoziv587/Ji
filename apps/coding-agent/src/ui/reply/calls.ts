// A tool call and its result as the two views show them. Every row is cut to fit, so a long one never wraps under
// the rail.

import type { ToolCall, ToolResultMessage } from '@ji.dev/llm'
import type { OutputTail } from '@ji.dev/tui'
import { styleText } from 'node:util'
import {
  clipToLine,
  detectLanguage,
  dimText,
  displayWidth,
  fitToWidth,
  formatCount,
  highlightCode,
  widthBesideRail,
} from '@ji.dev/tui'

/** The rows of a result the full view shows; the rest are counted. */
const RESULT_ROWS = 30

/** The full view's call: its name, then an argument a row. */
export function describeArguments(call: ToolCall): string {
  const args = Object.entries(call.arguments).map(([key, value]) => {
    const label = dimText(`${key}:`)
    return `${label} ${clipToLine(JSON.stringify(value), widthBesideRail() - displayWidth(label) - 1)}`
  })
  return [styleText('bold', call.name), ...args].join('\n')
}

/**
 * The full view's result: dim tool name and normal-colored result (red on error), to stand apart from the dim
 * thinking. A result of one line goes beside the name; a longer one under it, its first lines, or a command's last,
 * where it says how it went. A file read shows its first lines numbered and in color.
 */
export async function describeResult(call: ToolCall, result: ToolResultMessage): Promise<string> {
  const name = dimText(result.toolName)
  const width = widthBesideRail()
  const color = (text: string): string => (result.isError ? styleText('red', text) : text)
  // Tabs are as wide as the terminal says, which no clipping can know
  const lines = resultText(result).replaceAll('\t', '  ').split('\n')

  if (lines.length === 1) {
    return `${name}  ${color(clipToLine(lines[0], width - displayWidth(name) - 2))}`
  }

  const head = lines.slice(0, RESULT_ROWS)
  const rest = lines.length - head.length
  const more = rest > 0 ? [dimText(`… ${rest} more lines`)] : []
  const row = (line: string): string => color(fitToWidth(line, width))
  if (call.name === 'bash') {
    return [name, ...more, ...lines.slice(-RESULT_ROWS).map(row)].join('\n')
  }

  const { path, offset } = call.arguments
  if (result.isError || call.name !== 'read' || typeof path !== 'string') {
    return [name, ...head.map(row), ...more].join('\n')
  }

  const painted = await highlightCode(head.join('\n'), detectLanguage(path))
  const first = typeof offset === 'number' ? offset : 1
  const digits = String(first + painted.length - 1).length
  const numbered = painted.map(
    (line, i) => `${dimText(String(first + i).padStart(digits))}  ${fitToWidth(line, width - digits - 2)}`,
  )
  return [name, ...numbered, ...more].join('\n')
}

/**
 * The brief view's one row for a call: the call itself, with how many lines it gave the model when more than one, and
 * on error what went wrong, since that matters.
 */
export function describeDone(call: ToolCall, result: ToolResultMessage): string {
  if (!result.isError) {
    const lines = resultText(result).split('\n').length
    if (lines === 1) {
      return describeCall(call)
    }

    return describeCallWithNote(call, linesOf(lines))
  }

  // The error keeps at least half the row, and gives what it does not need to the call
  const width = widthBesideRail()
  const error = clipToLine(resultText(result), Number.POSITIVE_INFINITY)
  const head = describeCall(call, Math.max(width - displayWidth(error) - 2, Math.floor(width / 2)))
  return `${head}  ${styleText('red', clipToLine(error, width - displayWidth(head) - 2))}`
}

/** The row of a call the model is still writing: its arguments so far, and how many characters of them. */
export function describeWriting(call: ToolCall, chars: number): string {
  return describeCallWithNote(call, `${formatCount(chars)} chars`)
}

/** The row of a call still running: the call, how long it has run, and how many lines it has written. */
export function describeRunning(call: ToolCall, seconds: number, output: OutputTail): string {
  const lines = output.lines
  return describeCallWithNote(call, lines === 0 ? `${seconds}s` : `${seconds}s · ${linesOf(lines)}`)
}

/** A running call's last rows of output, dim, each cut to fit. */
export function describeRecent(output: OutputTail): string[] {
  return output.recent().map(line => dimText(fitToWidth(line, widthBesideRail())))
}

/** `1 line`, `340 lines`, `1.2k lines`. */
function linesOf(n: number): string {
  return `${formatCount(n)} ${n === 1 ? 'line' : 'lines'}`
}

function resultText(result: ToolResultMessage): string {
  return result.content.map(c => (c.type === 'text' ? c.text : `[${c.type}]`)).join('')
}

/** Formats as a call on one row: calc(expr: "17*23"), its arguments cut to fit `width`. */
function describeCall(call: ToolCall, width = widthBesideRail()): string {
  const args = Object.entries(call.arguments)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join(', ')
  // The name and the two parentheses take columns of their own
  return `${styleText('bold', call.name)}${dimText('(')}${clipToLine(args, width - displayWidth(call.name) - 2)}${dimText(')')}`
}

/** A call on one row with a dim note after it: the call is cut to leave the note its columns. */
function describeCallWithNote(call: ToolCall, note: string): string {
  const size = dimText(note)
  return `${describeCall(call, widthBesideRail() - displayWidth(size) - 2)}  ${size}`
}
