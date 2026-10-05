// The rail clack draws down the left of its prompts and messages, and text written beside it: each row after the rail
// and two spaces, so streamed text lines up with the prompts above and below.

import type { Writable } from 'node:stream'
import type { Rows } from './markdown/flow.ts'
import process from 'node:process'
import { styleText } from 'node:util'

/** clack's rail, as it draws it. */
export function paintRail(): string {
  return styleText('gray', '│')
}

/** The columns a row has after clack's symbol and the two spaces after it, short of the last column. */
export function widthBesideRail(): number {
  return Math.max(20, (process.stdout.columns || 80) - 4)
}

/**
 * Rows written to `output`, each after `rail`. The rail is written lazily, when a row gets its first text or turns out
 * blank, so a chunk ending in '\n' leaves no dangling rail; a blank row gets one too, so paragraphs stay connected.
 */
export function createRailRows(output: Writable, rail: string): Rows {
  let atLineStart = true
  return {
    write: text => {
      if (atLineStart) {
        output.write(`${rail}  `)
        atLineStart = false
      }
      output.write(text)
    },
    newline: () => {
      output.write(atLineStart ? `${rail}\n` : '\n')
      atLineStart = true
    },
  }
}
