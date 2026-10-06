// @ji.dev/plugin-truncate-tool-results: no tool result longer than maxChars reaches the model
//
//   A toolCall `after`: only the finished result changes, so tool_update events and the tool itself are untouched.
//   The outermost toolCall plugin sees the result last, so list this one first to cut what every other plugin returns.
//
//   text over the limit            what the model gets, at most maxChars
//
//   +------------------------+     +------------------------+
//   | head  ~75%             |     | head, to a line end    |
//   |   ... the middle ...   | ->  | [... omitted ...]      |  <- how much, and how to see it
//   | tail  ~25%             |     | tail, from a line start|
//   +------------------------+     +------------------------+

import type { Plugin, ToolResultMessage } from '@ji.dev/llm'
import { after, definePlugin } from '@ji.dev/llm'

export interface TruncateToolResultsOptions {
  /** Most characters of text one result keeps, all its text blocks together. At least 200. Default 30_000. */
  maxChars?: number
}

/** Room kept for the note: it is shorter than this even when both of its numbers have 16 digits. */
const NOTE_ROOM = 160

/** U+DC00 to U+DFFF, the second halves of surrogate pairs. Decimal: the formatter and the linter disagree on hex case. */
const LOW_SURROGATES = [56_320, 57_343] as const

/** A cut moves to a line boundary when one is within this share of the part it ends. */
const SNAP = 0.2

/**
 * Text over maxChars keeps its head and tail with a note in between, saying how much was left out and how to get it.
 * Several text blocks are joined into one first, so the limit holds for the whole result; images stay as they were.
 * The original length goes in details.truncated, when details is an object or absent: the model never sees details,
 * so UIs and logs can tell a cut result apart.
 */
export function createTruncateToolResultsPlugin({ maxChars = 30_000 }: TruncateToolResultsOptions = {}): Plugin {
  if (!Number.isInteger(maxChars) || maxChars < NOTE_ROOM + 40) {
    throw new RangeError(`maxChars must be an integer of at least ${NOTE_ROOM + 40}, got ${maxChars}`)
  }

  return definePlugin({
    name: 'truncate-tool-results',
    toolCall: after(result => truncateResult(result, maxChars)),
  })
}

function truncateResult(result: ToolResultMessage, maxChars: number): ToolResultMessage {
  const texts = result.content.flatMap(c => (c.type === 'text' ? [c.text] : []))
  // Measured before joining: most results are within the limit, and need no copy of their text
  const joinedLength = texts.reduce((n, t) => n + t.length, Math.max(0, texts.length - 1))
  if (joinedLength <= maxChars) {
    return result
  }

  const text = texts.join('\n')
  // The joined text takes the place of the first text block
  const first = result.content.findIndex(c => c.type === 'text')
  const content = result.content.flatMap((c, i): ToolResultMessage['content'] => {
    if (c.type !== 'text') {
      return [c]
    }
    return i === first ? [{ ...c, text: truncateText(text, maxChars) }] : []
  })

  return { ...result, content, details: withTruncated(result.details, text.length) }
}

function withTruncated(details: unknown, originalChars: number): unknown {
  if (details === undefined) {
    return { truncated: { originalChars } }
  }
  if (typeof details === 'object' && details !== null && !Array.isArray(details)) {
    return { ...details, truncated: { originalChars } }
  }
  return details
}

/**
 * At most maxChars (when maxChars leaves room for the note): about 75% from the head, which usually carries the
 * structure, and 25% from the tail, which carries a summary or the error. Each cut moves to a line boundary when one
 * is near, and never splits a surrogate pair.
 */
export function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text
  }

  const budget = Math.max(0, maxChars - NOTE_ROOM)
  const headBudget = Math.floor(budget * 0.75)
  const tailBudget = budget - headBudget
  const headEnd = snapBack(text, headBudget)
  const tailStart = snapForward(text, text.length - tailBudget)

  const lines = countNewlines(text, headEnd, tailStart)
  const note = `\n[... ${tailStart - headEnd} characters (${lines} lines) omitted; to see them, narrow the call: a line range, a filter, or head/tail ...]\n`
  return text.slice(0, headEnd) + note + text.slice(tailStart)
}

/** The head ends after the last newline in its final 20%, else at `end`; never inside a surrogate pair. */
function snapBack(text: string, end: number): number {
  const newline = text.lastIndexOf('\n', end - 1)
  const nearEnd = newline >= 0 && newline < end && newline + 1 >= end * (1 - SNAP)
  const snapped = nearEnd ? newline + 1 : end

  return isLowSurrogate(text.charCodeAt(snapped)) ? snapped - 1 : snapped
}

/** The tail starts after the first newline in its first 20%, else at `start`; never inside a surrogate pair. */
function snapForward(text: string, start: number): number {
  const newline = text.indexOf('\n', start)
  const nearStart = newline >= 0 && newline + 1 <= start + (text.length - start) * SNAP
  const snapped = nearStart ? newline + 1 : start

  return isLowSurrogate(text.charCodeAt(snapped)) ? snapped + 1 : snapped
}

/** Counted in place: splitting a large output into lines would allocate a string for each of them. */
function countNewlines(text: string, from: number, to: number): number {
  let lines = 0
  for (let i = text.indexOf('\n', from); i !== -1 && i < to; i = text.indexOf('\n', i + 1)) {
    lines++
  }
  return lines
}

function isLowSurrogate(code: number): boolean {
  return code >= LOW_SURROGATES[0] && code <= LOW_SURROGATES[1]
}
