// Text laid out in rows that fit: prose broken between words, code cut where a row fills, each row after a line's lead.

import type { Format, StyledText } from './inline.ts'
import { displayWidth, splitWords, wrapToRows } from '../text.ts'
import { paint } from './inline.ts'

/** Where the rows go: text on the row in progress, and the end of it. */
export interface Rows {
  write: (text: string) => void
  newline: () => void
}

/**
 * A line's rows, each at most `width` columns. A line has a lead before its first row and a hang before the others,
 * both as wide: a list item's marker, and the spaces under it.
 *
 * Prose goes a word at a time, and its last word waits for the next text, which may go on with it, so a row never
 * breaks inside a word. Where a row breaks, the spaces are left out, at its end as at the next one's start.
 */
export class Flow {
  private readonly rows: Rows
  private readonly width: () => number
  private lead = ''
  private hang = ''
  /** Nothing is written on the line yet: its first row starts with the lead, the others with the hang. */
  private first = true
  /** Nothing is written on the row in progress yet. */
  private rowStart = true
  /** The columns written on the row in progress, after its lead. */
  private column = 0
  /** The row is full: the next text goes on a new one, and spaces before it are left out. */
  private broken = false
  /** The last word, held back until it ends. */
  private word: StyledText | undefined
  /** The space before the next word: written with it, or left out where the row breaks. */
  private space: StyledText | undefined

  constructor(rows: Rows, width: () => number) {
    this.rows = rows
    this.width = width
  }

  /** The next line's lead and hang, painted. */
  start(lead: string, hang = lead): void {
    this.lead = lead
    this.hang = hang
  }

  /** Prose in `formats`, a word at a time. */
  add(text: string, formats: Format[]): void {
    let more = text
    if (this.word !== undefined) {
      if (sameFormats(this.word.formats, formats)) {
        more = this.word.text + more
      } else {
        this.place(this.word)
      }
      this.word = undefined
    }

    const words = splitWords(more)
    const last = words.at(-1)
    if (last !== undefined && last.trim() !== '') {
      this.word = { text: last, formats }
      words.pop()
    }
    for (const word of words) {
      this.place({ text: word, formats })
    }
  }

  /** Painted text from where the row is, going on to new rows as it fills them: code, or a table's line. */
  cut(text: string): void {
    const room = this.room()
    for (const [i, row] of wrapToRows(text, room, room - this.column).entries()) {
      if (i > 0) {
        this.broken = true
      }
      this.put(row)
    }
  }

  /** A whole line of painted text, cut into rows: a line of code or of a table, or a rule. */
  row(text: string): void {
    this.cut(text)
    this.endLine()
  }

  /** Ends the line: a blank one is a row of its own too. */
  endLine(): void {
    this.flush()
    this.rows.newline()
    this.lead = ''
    this.hang = ''
    this.first = true
    this.rowStart = true
    this.column = 0
    this.broken = false
    this.space = undefined
  }

  /** Ends the line, if one is in progress. */
  end(): void {
    this.flush()
    if (!this.first) {
      this.endLine()
    }
  }

  private flush(): void {
    if (this.word !== undefined) {
      this.place(this.word)
      this.word = undefined
    }
  }

  private place(word: StyledText): void {
    if (word.text.trim() === '') {
      this.space = this.column === 0 || this.broken ? undefined : word
      return
    }

    const space = this.space
    this.space = undefined
    if (this.column > 0 && this.column + displayWidth(space?.text ?? '') + displayWidth(word.text) > this.room()) {
      this.broken = true
      this.column = 0
    } else if (space !== undefined) {
      this.cut(paint(space))
    }
    this.cut(paint(word))
  }

  private put(text: string): void {
    if (text === '') {
      return
    }
    if (this.broken) {
      this.rows.newline()
      this.broken = false
      this.rowStart = true
      this.column = 0
    }
    if (this.rowStart) {
      this.rows.write(this.first ? this.lead : this.hang)
      this.first = false
      this.rowStart = false
    }
    this.rows.write(text)
    this.column += displayWidth(text)
  }

  private room(): number {
    return Math.max(1, this.width() - displayWidth(this.lead))
  }
}

function sameFormats(a: Format[], b: Format[]): boolean {
  return a.length === b.length && a.every((format, i) => format === b[i])
}
