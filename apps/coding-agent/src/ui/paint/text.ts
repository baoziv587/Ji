// Text for the terminal: measured in the columns it shows in, so a line cut to fit never wraps, colors and all; and
// the small pieces every part of it writes the same way: dim text, key hints, counts.

import process from 'node:process'
import { styleText } from 'node:util'
import { S_BAR } from '@clack/prompts'
import truncatedWidth from 'fast-string-truncated-width'

/** A key and what it does. */
export type Hint = [key: string, action: string]

/** A color or style code: `ESC [ … m`. Split on, it stays in the parts. */
// eslint-disable-next-line no-control-regex -- the code starts with ESC
const SGR = /(\x1B\[[\d;]*m)/

const GRAPHEMES = new Intl.Segmenter()

const WORDS = new Intl.Segmenter(undefined, { granularity: 'word' })

export function widthOf(text: string): number {
  return truncatedWidth(text).width
}

/**
 * As much of the start of `text` as fits in `width` columns. The ellipsis's column is kept apart: given one, the library
 * returns an index of -Infinity when the cut falls on a color code.
 */
export function fit(text: string, width: number): string {
  if (widthOf(text) <= width) {
    return text
  }

  const { index } = truncatedWidth(text, { limit: width - 1 })
  return `${text.slice(0, index)}\x1B[0m…`
}

/**
 * As much of the end of `text` as fits in `width` columns. It steps back a grapheme at a time from the end, so a long
 * text costs no more than a short one: the input line calls it on every draw.
 */
export function tail(text: string, width: number): string {
  const graphemes = GRAPHEMES.segment(text)
  let start = text.length
  let used = 0
  while (start > 0) {
    const { segment, index } = graphemes.containing(start - 1)!
    used += widthOf(segment)
    if (used > width) {
      break
    }
    start = index
  }
  return text.slice(start)
}

/**
 * `text` cut into rows, the first `first` columns wide and the rest `width`. A row that breaks inside a color closes
 * it, and the next row opens it again, so each row reads alone after a rail.
 */
export function wrapRows(text: string, width: number, first = width): string[] {
  const rows: string[] = []
  let row = ''
  let limit = first
  let used = 0
  // The colors opened since the last reset
  let open = ''

  for (const part of text.split(SGR)) {
    if (SGR.test(part)) {
      row += part
      open = part === '\x1B[0m' || part === '\x1B[m' ? '' : open + part
      continue
    }
    for (const { segment } of GRAPHEMES.segment(part)) {
      const columns = widthOf(segment)
      // A row with nothing in it takes one character however wide, unless it is a short first one
      if (used + columns > limit && (used > 0 || limit < width)) {
        rows.push(open === '' ? row : `${row}\x1B[0m`)
        row = open
        limit = width
        used = 0
      }
      row += segment
      used += columns
    }
  }

  rows.push(row)
  return rows
}

/**
 * The words of `text`, and the spaces between them. Punctuation after a word stays with it, to end a row; punctuation
 * after a space, or at the start, goes with the word after it, to start one: `docs (https`, `**bold`.
 */
export function wordsOf(text: string): string[] {
  const words: string[] = []
  // Punctuation waiting for the word after it
  let before = ''
  for (const { segment, isWordLike } of WORDS.segment(text)) {
    const last = words.at(-1)
    if (segment.trim() === '') {
      words.push(...(before === '' ? [segment] : [before, segment]))
      before = ''
    } else if (isWordLike === true) {
      words.push(before + segment)
      before = ''
    } else if (before === '' && last !== undefined && last.trim() !== '') {
      words[words.length - 1] = last + segment
    } else {
      before += segment
    }
  }
  if (before !== '') {
    words.push(before)
  }
  return words
}

/** Collapses to one line, cut to `width` columns, so wrapping doesn't break the left rail. */
export function clip(s: string, width = room()): string {
  return fit(s.replaceAll(/\s+/g, ' ').trim(), width)
}

/** The columns a row has after clack's symbol and the two spaces after it, short of the last column. */
export function room(): number {
  return Math.max(20, (process.stdout.columns || 80) - 4)
}

/** A count in a few characters: 950, 1.2k, 48.2k, 312k, 1.5M */
export function count(n: number): string {
  if (n < 1000) {
    return String(Math.round(n))
  }
  if (n < 1_000_000) {
    return `${short(n / 1000)}k`
  }
  return `${short(n / 1_000_000)}M`
}

export function dim(s: string): string {
  return styleText('dim', s)
}

export function bar(): string {
  return styleText('gray', S_BAR)
}

/**
 * The key in bold, so it stands out from the dim words around it; in `color` too where its part of the line has one.
 * Weight, not a color of its own: the colors already say who or what (cyan you, yellow a warning).
 */
export function hint(key: string, action: string, color?: 'cyan' | 'yellow'): string {
  if (color === undefined) {
    return `${styleText('bold', key)} ${dim(action)}`
  }
  return `${styleText([color, 'bold'], key)} ${styleText(color, action)}`
}

export function hints(list: Hint[]): string {
  return list.map(([key, action]) => hint(key, action)).join(dim(' · '))
}

/** One decimal below 100, none from there: 1.2, 48.2, 312. */
function short(n: number): string {
  return n < 100 ? n.toFixed(1).replace(/\.0$/, '') : n.toFixed(0)
}
