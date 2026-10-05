// A Markdown table as a grid that fits the terminal: its columns as wide as their text, or narrowed until the table
// fits, with the text in a narrowed one going on to more lines.
//
//   ┌───────┬───────┬──────────────┐
//   │ Name  │ Width │ Notes        │   <- the header, in bold
//   ├───────┼───────┼──────────────┤
//   │ 中文  │     2 │ CJK, two     │   <- each column aligned as its delimiter says (:--, :-:, --:)
//   │       │       │ columns each │
//   ├───────┼───────┼──────────────┤   <- a line between rows, so a cell of two lines reads as one
//   │ emoji │     2 │ **bold**     │
//   └───────┴───────┴──────────────┘
//
// Widths as pi-tui's renderTable gives them: https://github.com/earendil-works/pi (packages/tui/src/components/markdown.ts)

import type { Tokens } from 'marked'
import type { Flow } from './flow.ts'
import type { Piece } from './inline.ts'
import { Lexer } from 'marked'
import { dimText, displayWidth, splitWords, wrapToRows } from '../text.ts'
import { paint, piecesOf, textOf } from './inline.ts'

type Align = Tokens.TableCell['align']

/** A column narrowed to fit is kept at least as wide as its longest word, up to this. */
const LONGEST_WORD = 30

/** A table's first line, its header, if a delimiter row follows it. */
const HEADER = /^ {0,3}\|/

/** The line under a table's header: `|---|:--:|`. */
const DELIMITER = /^[\s|:]*-[\s|:-]*$/

/**
 * A table as it streams in: held back until a line that is not one of its rows ends it, since its widths depend on all
 * of it. One that turns out not to be a table, or that cannot fit, goes back as text, a line at a time.
 */
export class Table {
  private readonly flow: Flow
  private readonly width: () => number
  private readonly text: (line: string) => void
  private lines: string[] | undefined

  constructor(flow: Flow, width: () => number, text: (line: string) => void) {
    this.flow = flow
    this.width = width
    this.text = text
  }

  get open(): boolean {
    return this.lines !== undefined
  }

  /** Starts a table if `line` may be its header. */
  start(line: string): boolean {
    if (!HEADER.test(line)) {
      return false
    }
    this.lines = [line]
    return true
  }

  /** Takes `line` if it goes on with the table: the delimiter row under its header, then rows with a pipe. */
  add(line: string): boolean {
    if (this.lines === undefined) {
      return false
    }

    let goesOn: boolean
    if (this.lines.length === 1) {
      goesOn = DELIMITER.test(line) && line.includes('|')
    } else {
      goesOn = line.includes('|') && line.trim() !== ''
    }

    if (goesOn) {
      this.lines.push(line)
    }
    return goesOn
  }

  /** `table · 14 rows` once a delimiter row shows it is one, so a wait for it reads as one; empty otherwise. */
  describe(): string {
    if (this.lines === undefined || this.lines.length < 2) {
      return ''
    }

    const rows = this.lines.length - 2
    return `table · ${rows} ${rows === 1 ? 'row' : 'rows'}`
  }

  /** Draws the table, or gives its lines back as text. */
  end(): void {
    if (this.lines === undefined) {
      return
    }

    const lines = this.lines
    this.lines = undefined
    const drawn = lines.length > 1 ? drawTable(lines.join('\n'), this.width()) : undefined
    if (drawn === undefined) {
      for (const line of lines) {
        this.text(line)
      }
      return
    }
    for (const line of drawn) {
      this.flow.row(line)
    }
  }
}

/**
 * The lines of the table in `markdown`, at most `width` columns wide; undefined when it is not a table, or when the
 * table has so many columns that not even one character of each fits.
 */
export function drawTable(markdown: string, width: number): string[] | undefined {
  const [token] = Lexer.lex(markdown, { gfm: true })
  if (token?.type !== 'table') {
    return undefined
  }

  const table = token as Tokens.Table
  const header = table.header.map(cell => piecesOf(cell.tokens, ['bold']))
  const rows = table.rows.map(row => row.map(cell => piecesOf(cell.tokens, [])))
  const widths = widthsOf([header, ...rows], width)
  if (widths === undefined) {
    return undefined
  }

  const rule = (left: string, middle: string, right: string): string =>
    dimText(`${left}─${widths.map(w => '─'.repeat(w)).join(`─${middle}─`)}─${right}`)
  const lines = (cells: Piece[][]): string[] => linesOf(cells, widths, table.align)
  const between = rule('├', '┼', '┤')

  return [
    rule('┌', '┬', '┐'),
    ...lines(header),
    between,
    ...rows.flatMap((row, i) => (i === 0 ? lines(row) : [between, ...lines(row)])),
    rule('└', '┴', '┘'),
  ]
}

/**
 * Each column's width, borders apart. A table that fits keeps the widths of its text; one that does not gives each
 * column its longest word first, then what is left in proportion to what each still lacks.
 */
function widthsOf(table: Piece[][][], width: number): number[] | undefined {
  const columns = table[0].length
  // `│ ` before each cell, ` │` after the last, and ` │ ` between
  const room = width - (3 * columns + 1)
  if (room < columns) {
    return undefined
  }

  const natural = Array.from<number>({ length: columns }).fill(1)
  const longest = Array.from<number>({ length: columns }).fill(1)
  for (const row of table) {
    for (const [i, cell] of row.entries()) {
      natural[i] = Math.max(natural[i], displayWidth(textOf(cell)))
      for (const piece of cell) {
        for (const word of splitWords(piece.text)) {
          longest[i] = Math.max(longest[i], Math.min(LONGEST_WORD, displayWidth(word)))
        }
      }
    }
  }
  if (sum(natural) <= room) {
    return natural
  }

  let least = longest
  if (sum(longest) > room) {
    // Not even the longest words fit: one character each, and the rest in proportion to them
    least = share(
      room - columns,
      longest.map(w => w - 1),
    ).map(w => w + 1)
  }
  const more = share(
    room - sum(least),
    natural.map((w, i) => Math.max(0, w - least[i])),
  )
  return least.map((w, i) => w + more[i])
}

/** `total` in proportion to `weights`, none getting more than its weight; what rounding leaves goes one each, in order. */
function share(total: number, weights: number[]): number[] {
  const all = sum(weights)
  const parts = weights.map(w => Math.floor((total * w) / all))
  let left = total - sum(parts)
  for (let i = 0; i < parts.length && left > 0; i++) {
    if (parts[i] < weights[i]) {
      parts[i]++
      left--
    }
  }
  return parts
}

/** One row of the table: as many lines as its tallest cell, the others filled with blank ones. */
function linesOf(cells: Piece[][], widths: number[], align: Align[]): string[] {
  const wrapped = cells.map((cell, i) => wrap(cell, widths[i]))
  const height = Math.max(...wrapped.map(lines => lines.length))
  const border = dimText('│')

  const lines: string[] = []
  for (let line = 0; line < height; line++) {
    const texts = wrapped.map((lines, i) => pad(lines[line] ?? '', widths[i], align[i]))
    lines.push(`${border} ${texts.join(` ${border} `)} ${border}`)
  }
  return lines
}

/** A cell's text in lines of at most `width` columns, broken between words; a word longer than a line is cut. */
function wrap(cell: Piece[], width: number): string[] {
  const lines: string[] = []
  let line = ''
  let used = 0
  // The space before the next word: left out where a line breaks
  let space = ''

  for (const { text, formats } of cell) {
    for (const word of splitWords(text)) {
      if (word.trim() === '') {
        space = used === 0 ? '' : paint({ text: word, formats })
        continue
      }

      if (used > 0 && used + displayWidth(space) + displayWidth(word) > width) {
        lines.push(line)
        line = ''
        used = 0
      } else {
        line += space
        used += displayWidth(space)
      }
      space = ''

      const rows = wrapToRows(paint({ text: word, formats }), width, width - used)
      for (const [i, row] of rows.entries()) {
        if (i > 0) {
          lines.push(line)
          line = ''
          used = 0
        }
        line += row
        used += displayWidth(row)
      }
    }
  }

  lines.push(line)
  return lines
}

/** A line of a cell, filled out to `width` with spaces on the side its alignment leaves open. */
function pad(text: string, width: number, align: Align): string {
  const gap = Math.max(0, width - displayWidth(text))
  switch (align) {
    case 'right':
      return ' '.repeat(gap) + text
    case 'center':
      return ' '.repeat(Math.floor(gap / 2)) + text + ' '.repeat(Math.ceil(gap / 2))
    default:
      return text + ' '.repeat(gap)
  }
}

function sum(numbers: number[]): number {
  return numbers.reduce((a, b) => a + b, 0)
}
