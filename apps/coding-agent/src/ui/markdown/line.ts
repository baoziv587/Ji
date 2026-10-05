// A line of text as it streams in: a heading, a list item, a quote, a paragraph's line, or a rule.

import type { Flow } from './flow.ts'
import type { Format } from './inline.ts'
import { styleText } from 'node:util'
import { dim, widthOf } from '../paint/text.ts'
import { InlineStream } from './inline.ts'

const BULLETS = ['•', '◦', '▪']

const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/

const QUOTE = /^ {0,3}>[ \t]?/

const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+|$)/

/** A list item: its indent, its marker, and a task's box. */
const ITEM = /^( *)([-*+]|\d{1,9}[.)])(?:[ \t]+|$)(?:\[([ x])\](?:[ \t]+|$))?/i

/**
 * Once a line's start shows what it is, its lead is set and the rest of its text goes on a word at a time. A list
 * item's rows line up under its text, and so does a line under it that is not an item.
 */
export class Line {
  private readonly flow: Flow
  private readonly width: () => number
  private inline: InlineStream | undefined
  /** The indents of the list items the text is in, outermost first. */
  private lists: number[] = []

  constructor(flow: Flow, width: () => number) {
    this.flow = flow
    this.width = width
  }

  /** A line has started, and the rest of its text goes to add(). */
  get open(): boolean {
    return this.inline !== undefined
  }

  /** Starts a line with as much of it as shows what it is. */
  start(line: string): void {
    let text = line
    let depth = 0
    for (let quote = QUOTE.exec(text); quote !== null; quote = QUOTE.exec(text)) {
      depth++
      text = text.slice(quote[0].length)
    }
    const bars = `${styleText('gray', '▎')} `.repeat(depth)
    const formats: Format[] = depth === 0 ? [] : ['dim']

    const heading = HEADING.exec(text)
    const item = ITEM.exec(text)
    if (heading !== null) {
      this.lists = []
      const style: Format[] = heading[1].length === 1 ? ['bold', 'underline'] : ['bold']
      this.begin(bars, bars, text.slice(heading[0].length), [...formats, ...style])
    } else if (item !== null) {
      const lead = `${bars}${this.markerOf(item)} `
      this.begin(lead, bars + ' '.repeat(widthOf(lead) - widthOf(bars)), text.slice(item[0].length), formats)
    } else {
      const indent = /^ */.exec(text)![0]
      // A line not under an item ends the list
      if (indent === '' && text !== '') {
        this.lists = []
      }
      const pad = this.lists.length === 0 ? '' : indent
      this.begin(bars + pad, bars + pad, text.slice(indent.length), formats)
    }
  }

  add(text: string): void {
    this.inline?.add(text)
  }

  end(): void {
    this.inline?.end()
    this.inline = undefined
    this.flow.endLine()
  }

  /** A line that came whole: a rule, or text. */
  write(line: string): void {
    if (RULE.test(line)) {
      this.lists = []
      this.flow.row(dim('─'.repeat(this.width())))
      return
    }

    this.start(line)
    this.end()
  }

  /** The text is over: a list is too. */
  reset(): void {
    this.lists = []
  }

  /** An item's marker, after the indent of its depth: its number, a task's box, or a bullet for its depth. */
  private markerOf([, indent, marker, task]: RegExpExecArray): string {
    while (this.lists.length > 0 && this.lists.at(-1)! > indent.length) {
      this.lists.pop()
    }
    if (this.lists.at(-1) !== indent.length) {
      this.lists.push(indent.length)
    }
    const depth = this.lists.length - 1

    let shown: string
    if (task !== undefined) {
      shown = task === ' ' ? '☐' : styleText('green', '☑')
    } else if (/\d/.test(marker)) {
      shown = marker
    } else {
      shown = styleText('gray', BULLETS[depth % BULLETS.length])
    }
    return `${'  '.repeat(depth)}${shown}`
  }

  private begin(lead: string, hang: string, text: string, formats: Format[]): void {
    this.flow.start(lead, hang)
    this.inline = new InlineStream(pieces => {
      for (const piece of pieces) {
        this.flow.add(piece.text, piece.formats)
      }
    }, formats)
    this.inline.add(text)
  }
}
