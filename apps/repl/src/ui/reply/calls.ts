// A tool call and its result as the two views show them. Every row is cut to fit, so a long one never wraps under
// the rail.

import type { ToolCall, ToolResultMessage } from '@ji.dev/llm'
import { stripVTControlCharacters, styleText } from 'node:util'
import { highlight, languageOf } from '../paint/highlight.ts'
import { clip, count, dim, fit, room, widthOf } from '../paint/text.ts'

/** The rows of a result the full view shows; the rest are counted. */
const RESULT_ROWS = 30

/** The columns the status gives a running call's last line, as many as the thinking's last words. */
const LAST_LINE = 48

/** The most kept of a line still being written: a progress bar can go on for long without one. */
const PARTIAL = 1000

/**
 * What a running call has written so far, from its tool_updates, for the status: `340 lines · ✓ 212 tests passed`.
 * An update is text, or a command's chunk (`{ fd, text }`); anything else, a question say, is not output.
 */
export class Output {
  private lines = 0
  /** The last line with text in it. */
  private last = ''
  /** The line still being written. */
  private partial = ''

  add(data: unknown): void {
    const text = textOf(data)
    if (text === undefined) {
      return
    }

    const lines = (this.partial + text).split('\n')
    this.partial = lines.pop()!.slice(-PARTIAL)
    this.lines += lines.length
    const last = lines.findLast(line => shown(line) !== '')
    if (last !== undefined) {
      this.last = shown(last)
    }
  }

  /** Empty until it has written something. */
  describe(): string {
    const lines = this.lines + (this.partial === '' ? 0 : 1)
    if (lines === 0) {
      return ''
    }

    const last = shown(this.partial) || this.last
    const size = `${count(lines)} ${lines === 1 ? 'line' : 'lines'}`
    return dim(last === '' ? size : `${size} · ${fit(last, LAST_LINE)}`)
  }
}

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
 * thinking. A result of one line goes beside the name; a longer one under it, its first lines, or a command's last,
 * where it says how it went. A file read shows its first lines numbered and in color.
 */
export async function describeResult(call: ToolCall, result: ToolResultMessage): Promise<string> {
  const name = dim(result.toolName)
  const width = room()
  const color = (text: string): string => (result.isError ? styleText('red', text) : text)
  // Tabs are as wide as the terminal says, which no clipping can know
  const lines = resultText(result).replaceAll('\t', '  ').split('\n')

  if (lines.length === 1) {
    return `${name}  ${color(clip(lines[0], width - widthOf(name) - 2))}`
  }

  const head = lines.slice(0, RESULT_ROWS)
  const rest = lines.length - head.length
  const more = rest > 0 ? [dim(`… ${rest} more lines`)] : []
  const row = (line: string): string => color(fit(line, width))
  if (call.name === 'bash') {
    return [name, ...more, ...lines.slice(-RESULT_ROWS).map(row)].join('\n')
  }

  const { path, offset } = call.arguments
  if (result.isError || call.name !== 'read' || typeof path !== 'string') {
    return [name, ...head.map(row), ...more].join('\n')
  }

  const painted = await highlight(head.join('\n'), languageOf(path))
  const first = typeof offset === 'number' ? offset : 1
  const digits = String(first + painted.length - 1).length
  const numbered = painted.map(
    (line, i) => `${dim(String(first + i).padStart(digits))}  ${fit(line, width - digits - 2)}`,
  )
  return [name, ...numbered, ...more].join('\n')
}

/**
 * The brief view's one row for a call: the call itself, with how many lines it gave the model when more than one, and
 * on error what went wrong, since that matters.
 */
export function describeDone(call: ToolCall, result: ToolResultMessage): string {
  const width = room()
  if (!result.isError) {
    const lines = resultText(result).split('\n').length
    if (lines === 1) {
      return describeCall(call)
    }

    const size = dim(`${count(lines)} lines`)
    return `${describeCall(call, width - widthOf(size) - 2)}  ${size}`
  }

  // The error keeps at least half the row, and gives what it does not need to the call
  const error = clip(resultText(result), Number.POSITIVE_INFINITY)
  const head = describeCall(call, Math.max(width - widthOf(error) - 2, Math.floor(width / 2)))
  return `${head}  ${styleText('red', clip(error, width - widthOf(head) - 2))}`
}

/** A tool_update's text: itself, or a chunk's `text`. */
function textOf(data: unknown): string | undefined {
  if (typeof data === 'string') {
    return data
  }
  const text: unknown = (data as { text?: unknown } | null)?.text
  return typeof text === 'string' ? text : undefined
}

/** A line as the status shows it: no colors, only what a progress bar drew last, and its spaces collapsed. */
function shown(line: string): string {
  const plain = stripVTControlCharacters(line).replace(/\r$/, '')
  return clip(plain.slice(plain.lastIndexOf('\r') + 1), Number.POSITIVE_INFINITY)
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
