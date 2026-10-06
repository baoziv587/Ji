// Inline Markdown: bold, italic, struck out, code and links, as text in the styles around it.
//
//   flattenInlineTokens  marked's nested inline tokens as a flat list of styled pieces: a table's cells, and a line
//                        once it ends
//   InlineStream         a line as it streams in: plain text goes at once, a span from where it may open until it
//                        closes

import type { Token } from 'marked'
import { styleText } from 'node:util'
import { Lexer } from 'marked'
import { paintInlineCode } from '../highlight.ts'

/** A style styleText knows. */
type StyleFormat = Extract<Parameters<typeof styleText>[0], readonly unknown[]>[number]

/** A style styleText knows, or `code`: inline code, in a color of its own. */
export type Format = StyleFormat | 'code'

/** Text in the styles around it: a line or a cell is a run of these. */
export interface StyledText {
  text: string
  formats: Format[]
}

/** A span that has not closed after this many characters never will, or not soon: it is let go as it is. */
const LONGEST_SPAN = 120

const LETTER_OR_DIGIT = /[A-Z0-9]/i

/** What a backslash escapes: ASCII punctuation. */
const ESCAPED = new Set('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~')

export function textOf(pieces: StyledText[]): string {
  return pieces.map(p => p.text).join('')
}

export function paint({ text, formats }: StyledText): string {
  const styles = formats.filter((format): format is StyleFormat => format !== 'code')
  const styled = styles.length === 0 ? text : styleText(styles, text)
  return formats.includes('code') ? paintInlineCode(styled) : styled
}

/**
 * Inline tokens, nested as bold in a link, flattened into styled pieces: each in `formats` and the styles around it;
 * a link has its address after it.
 */
export function flattenInlineTokens(tokens: Token[], formats: Format[]): StyledText[] {
  return tokens.flatMap((token): StyledText[] => {
    switch (token.type) {
      case 'strong':
        return flattenInlineTokens(token.tokens ?? [], [...formats, 'bold'])
      case 'em':
        return flattenInlineTokens(token.tokens ?? [], [...formats, 'italic'])
      case 'del':
        return flattenInlineTokens(token.tokens ?? [], [...formats, 'strikethrough'])
      case 'codespan':
        return [{ text: token.text, formats: [...formats, 'code'] }]
      case 'link': {
        const text = flattenInlineTokens(token.tokens ?? [], [...formats, 'underline'])
        return textOf(text) === token.href
          ? text
          : [...text, { text: ` (${token.href})`, formats: [...formats, 'dim'] }]
      }
      case 'br':
        return [{ text: ' ', formats }]
      case 'text':
      case 'escape':
      case 'html':
        return [{ text: token.text, formats }]
      default:
        return [{ text: token.raw, formats }]
    }
  })
}

/**
 * One line's inline Markdown as it streams in. What cannot open a span is let go at once; from a mark that may open
 * one (`**`, `` ` ``, `[`), the text waits until marked reads a span that something follows, so it is sure to have
 * closed. A mark that has not closed by the line's end, or after a long while, is let go as it is.
 *
 * A single `*` or `_` after a letter or digit opens nothing here (`2*3`, `snake_case`), and neither does a mark before
 * a space (`a * b`): either would hold up the rest of the line, waiting for a close that seldom comes.
 */
export class InlineStream {
  private readonly emit: (pieces: StyledText[]) => void
  private readonly formats: Format[]
  private pending = ''
  /** The last character let go, to tell whether a mark after it may open a span. */
  private last = ''

  constructor(emit: (pieces: StyledText[]) => void, formats: Format[]) {
    this.emit = emit
    this.formats = formats
  }

  add(text: string): void {
    this.pending += text
    this.release()
  }

  /** The line has ended: what waits is read as it is. */
  end(): void {
    if (this.pending !== '') {
      this.emit(flattenInlineTokens(Lexer.lexInline(this.pending), this.formats))
    }
    this.pending = ''
    this.last = ''
  }

  private release(): void {
    for (;;) {
      const at = this.opening()
      this.let(this.pending.slice(0, at))
      if (at === this.pending.length) {
        this.pending = ''
        return
      }
      this.pending = this.pending.slice(at)

      const [first, ...rest] = Lexer.lexInline(this.pending)
      if (first.type !== 'text' && rest.length > 0) {
        this.emit(flattenInlineTokens([first], this.formats))
        this.last = first.raw.at(-1) ?? ''
        this.pending = this.pending.slice(first.raw.length)
      } else if (this.neverCloses()) {
        const mark = /^(.)\1*/.exec(this.pending)![0]
        this.let(mark)
        this.pending = this.pending.slice(mark.length)
      } else {
        return
      }
    }
  }

  /** Where the first mark that may open a span is, or the end. */
  private opening(): number {
    const text = this.pending
    for (let i = 0; i < text.length; i++) {
      if (this.mayOpen(i)) {
        return i
      }
    }
    return text.length
  }

  private mayOpen(i: number): boolean {
    const text = this.pending
    const mark = text[i]
    switch (mark) {
      case '`':
      case '[':
        return true
      case '\\':
        // Only before what it escapes, so a path with backslashes goes at once
        return i + 1 === text.length || ESCAPED.has(text[i + 1])
      case '*':
      case '_':
      case '~': {
        let run = 1
        while (text[i + run] === mark) {
          run++
        }
        const before = i === 0 ? this.last : text[i - 1]
        const after = text[i + run]
        if (after === undefined) {
          return true
        }
        if (/\s/.test(after) || (mark === '~' && run < 2)) {
          return false
        }
        return run > 1 || !LETTER_OR_DIGIT.test(before)
      }
      default:
        return false
    }
  }

  /** Whether the span at the start can no longer close: a link's text without `(` after it, or a long wait. */
  private neverCloses(): boolean {
    return /^\[[^\]]*\][^(]/.test(this.pending) || this.pending.length > LONGEST_SPAN
  }

  private let(text: string): void {
    if (text !== '') {
      this.emit([{ text, formats: this.formats }])
      this.last = text.at(-1)!
    }
  }
}
