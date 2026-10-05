// A tool call and its result as the two views show them. Every row is cut to fit, so a long one never wraps under
// the rail.

import type { ToolCall, ToolResultMessage } from '@ji.dev/llm'
import { stripVTControlCharacters, styleText } from 'node:util'
import { highlight, languageOf } from '../paint/highlight.ts'
import { clip, count, dim, fit, room, widthOf } from '../paint/text.ts'

/** The rows of a result the full view shows; the rest are counted. */
const RESULT_ROWS = 30

/** The rows of a call's output shown while it runs, and kept under it if it fails. */
const RECENT_ROWS = 5

/** The most kept of a line still being written: a progress bar can go on for long without one. */
const PARTIAL = 1000

/**
 * What a running call has written so far, from its tool_updates: how many lines, and the last ones with text. An
 * update is text, or a command's chunk (`{ fd, text }`); anything else, a question say, is not output.
 */
export class Output {
  /** The lines ended so far. */
  private ended = 0
  /** The last of them with text, as shown. */
  private last: string[] = []
  /** The line still being written. */
  private partial = ''

  add(data: unknown): void {
    const text = textOf(data)
    if (text === undefined) {
      return
    }

    const lines = (this.partial + text).split('\n')
    this.partial = lines.pop()!.slice(-PARTIAL)
    this.ended += lines.length

    // Only the end of a chunk can be among the last rows
    const fresh: string[] = []
    for (let i = lines.length - 1; i >= 0 && fresh.length < RECENT_ROWS; i--) {
      const line = shown(lines[i])
      if (line !== '') {
        fresh.unshift(line)
      }
    }
    this.last = [...this.last, ...fresh].slice(-RECENT_ROWS)
  }

  get lines(): number {
    return this.ended + (this.partial === '' ? 0 : 1)
  }

  /** The last rows with text, the one still being written too: what a progress bar drew last. */
  recent(): string[] {
    const partial = shown(this.partial)
    return (partial === '' ? this.last : [...this.last, partial]).slice(-RECENT_ROWS)
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

    const size = dim(linesOf(lines))
    return `${describeCall(call, width - widthOf(size) - 2)}  ${size}`
  }

  // The error keeps at least half the row, and gives what it does not need to the call
  const error = clip(resultText(result), Number.POSITIVE_INFINITY)
  const head = describeCall(call, Math.max(width - widthOf(error) - 2, Math.floor(width / 2)))
  return `${head}  ${styleText('red', clip(error, width - widthOf(head) - 2))}`
}

/** The row of a call still running: the call, how long it has run, and how many lines it has written. */
export function describeRunning(call: ToolCall, seconds: number, output: Output): string {
  const lines = output.lines
  const size = dim(lines === 0 ? `${seconds}s` : `${seconds}s · ${linesOf(lines)}`)
  return `${describeCall(call, room() - widthOf(size) - 2)}  ${size}`
}

/** A running call's last rows of output, dim, each cut to fit. */
export function describeRecent(output: Output): string[] {
  return output.recent().map(line => dim(fit(line, room())))
}

/** A tool_update's text: itself, or a chunk's `text`. */
function textOf(data: unknown): string | undefined {
  if (typeof data === 'string') {
    return data
  }
  const text: unknown = (data as { text?: unknown } | null)?.text
  return typeof text === 'string' ? text : undefined
}

/** A line of output as a row shows it: no colors or other control codes, and only what a progress bar drew last. */
function shown(line: string): string {
  const plain = stripVTControlCharacters(line).replace(/\r$/, '')
  // eslint-disable-next-line no-control-regex -- the codes left after the colors
  return plain
    .slice(plain.lastIndexOf('\r') + 1)
    .replaceAll('\t', '  ')
    .replaceAll(/[\x00-\x1F\x7F]/g, '')
    .trimEnd()
}

/** `1 line`, `340 lines`, `1.2k lines`. */
function linesOf(n: number): string {
  return `${count(n)} ${n === 1 ? 'line' : 'lines'}`
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
