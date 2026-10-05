// What a running command has written so far: how many lines, and the last ones with text, as a row shows them.

import { stripVTControlCharacters } from 'node:util'

/** The rows of output kept. */
const RECENT_ROWS = 5

/** The most kept of a line still being written: a progress bar can go on for long without one. */
const PARTIAL = 1000

/**
 * The tail of a stream of output: how many lines it has, and the last ones with text. A chunk is text, or a command's
 * chunk (`{ fd, text }`); anything else is not output.
 */
export class OutputTail {
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

/** A chunk's text: itself, or its `text`. */
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
  return (
    plain
      .slice(plain.lastIndexOf('\r') + 1)
      .replaceAll('\t', '  ')
      // eslint-disable-next-line no-control-regex -- the codes left after the colors
      .replaceAll(/[\x00-\x1F\x7F]/g, '')
      .trimEnd()
  )
}
