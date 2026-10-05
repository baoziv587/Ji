// A reply's streamed text, written to the right of clack's rail, lined up with the prompts above and below.

import type { Writable } from 'node:stream'
import type { PaintLine } from '../paint/highlight.ts'
import process from 'node:process'
import { styleText } from 'node:util'
import { languageOf, loadLanguage } from '../paint/highlight.ts'
import { drawTable } from '../paint/table.ts'
import { bar, count, dim, room, tail, widthOf, wordsOf, wrapRows } from '../paint/text.ts'

export type BlockKind = 'thinking' | 'text'

/** The two views: brief leaves out what full shows in detail. */
export interface Views {
  brief: Writable
  full: Writable
}

interface Block {
  title?: string
  rail: string
  paint: (s: string) => string
  output: Writable
}

/** Enough of the thinking's end to fill the status. */
const RECENT = 200

/** A line that may still turn out to be a fence or a table's first: up to three spaces, then backticks or a pipe. */
const MAY_OPEN = /^ {0,3}(?:`{0,3}$|```|\|)/

/** A table's first line, its header, if a delimiter row follows it. */
const TABLE_START = /^ {0,3}\|/

/** The line under a table's header: `|---|:--:|`. */
const DELIMITER = /^[\s|:]*-[\s|:-]*$/

/** A fence: its backticks, and the language after them. */
const FENCE = /^ {0,3}(`{3,})\s*([^`\s]*)/

/**
 * Thinking and answer text each get their own block. The rail is written lazily, when a line gets its first text or
 * turns out to be blank, so a chunk ending in '\n' leaves no dangling rail and end() knows whether a line is still
 * open.
 *
 * A line too long for the terminal goes on in rows of its own, each after the rail, instead of being wrapped by the
 * terminal back to its first column. Prose breaks between words, so a streamed line's last word waits for its end.
 *
 * A code block in the answer is painted a line at a time, since a line's colors depend on all of it: every line in
 * one is held back until it ends, and so is a line that may still turn out to open or close one. A table is held back
 * the same way, and drawn as a whole once a line that is not one of its rows ends it.
 */
export class Gutter {
  private readonly views: Views
  private readonly blocks: Record<BlockKind, Block>
  private open: BlockKind | undefined
  private atLineStart = true
  /** The columns written on the row in progress, after its rail. */
  private column = 0
  /** The row is full: the next text goes on a new one, and spaces before it are left out. */
  private broken = false
  /** The last word of the prose, held back until it ends, so a row never breaks inside it. */
  private word = ''
  /** The thinking block in progress: how long and how much, and its last words for the status. */
  private thought: { since: number; chars: number; recent: string } | undefined
  /** The answer's line in progress, while it is held back. */
  private held = ''
  /** The code block the answer is in: the backticks that close it, and what paints its lines. */
  private code: { fence: string; paint: PaintLine } | undefined
  /** The table the answer is in, held back until it ends: its widths depend on all of it. Its header alone may not be one. */
  private table: string[] | undefined

  /** `both` is what the two views show alike: stdout, unless a test says otherwise. */
  constructor(views: Views, both: Writable = process.stdout) {
    this.views = views
    // Thinking is written in full to the full view only; the brief one gets a line for it once it ends
    this.blocks = {
      thinking: {
        title: `${styleText('gray', '◌')}  ${styleText(['dim', 'italic'], 'Thinking')}`,
        rail: styleText('gray', '┊'),
        paint: s => styleText(['dim', 'italic'], s),
        output: views.full,
      },
      text: { rail: bar(), paint: s => s, output: both },
    }
  }

  async write(chunk: string, kind: BlockKind): Promise<void> {
    const block = this.blocks[kind]
    if (this.open !== kind) {
      this.end()
      block.output.write(`${bar()}\n${block.title === undefined ? '' : `${block.title}\n`}`)
      this.open = kind
    }

    if (kind === 'thinking') {
      this.thought ??= { since: performance.now(), chars: 0, recent: '' }
      this.thought.chars += [...chunk].length
      this.thought.recent = (this.thought.recent + chunk).slice(-RECENT)
    }

    for (const [i, part] of chunk.split('\n').entries()) {
      if (i > 0) {
        await this.endLine(block)
      }
      this.add(part, block)
    }
  }

  /** `1.2k chars · …so I'll call calc`: how much it has thought, and its last words; empty while not thinking. */
  describeThought(): string {
    if (this.thought === undefined) {
      return ''
    }

    const words = this.thought.recent.replaceAll(/\s+/g, ' ').trim()
    return dim(`${count(this.thought.chars)} chars · …${tail(words, 48)}`)
  }

  /** Closes the current block so the next output starts on a fresh line; a thinking one gets its line in brief. */
  end(): void {
    if (this.open !== undefined) {
      const block = this.blocks[this.open]
      if (this.code !== undefined) {
        this.putRows(this.code.paint(this.held), block)
      } else if (this.table !== undefined && continuesTable(this.table, this.held)) {
        this.table.push(this.held)
        this.endTable(block)
      } else {
        this.endTable(block)
        this.flow(this.held, block, true)
      }
    }
    this.held = ''
    this.code = undefined
    this.table = undefined
    this.broken = false

    if (this.open && !this.atLineStart) {
      this.blocks[this.open].output.write('\n')
    }

    if (this.thought !== undefined) {
      const seconds = Math.max(1, Math.round((performance.now() - this.thought.since) / 1000))
      const title = styleText(['dim', 'italic'], `Thought for ${seconds}s`)
      const length = dim(`· ${count(this.thought.chars)} chars`)
      this.views.brief.write(`${bar()}\n${styleText('gray', '◌')}  ${title} ${length}\n`)
      this.thought = undefined
    }

    this.open = undefined
    this.atLineStart = true
  }

  /** Text for the line in progress: written at once, unless the answer's line is held back. */
  private add(part: string, block: Block): void {
    const line = this.held + part
    if (block === this.blocks.text && (this.code !== undefined || this.table !== undefined || MAY_OPEN.test(line))) {
      this.held = line
      return
    }

    this.held = ''
    this.flow(line, block, false)
  }

  /** Ends the line in progress: one held back turns out a fence, a line of code, a table's, or plain text after all. */
  private async endLine(block: Block): Promise<void> {
    const line = this.held
    this.held = ''
    if (this.table !== undefined) {
      if (continuesTable(this.table, line)) {
        this.table.push(line)
        return
      }
      this.endTable(block)
    }

    const fence = FENCE.exec(line)

    if (this.code !== undefined) {
      const closes = fence !== null && fence[2] === '' && fence[1].length >= this.code.fence.length
      this.putRows(closes ? dim(line) : this.code.paint(line), block)
      if (closes) {
        this.code = undefined
      }
    } else if (fence !== null) {
      const start = await loadLanguage(languageOf(fence[2]))
      this.code = { fence: fence[1], paint: start() }
      this.putRows(dim(line), block)
    } else if (TABLE_START.test(line)) {
      this.table = [line]
      return
    } else {
      this.flow(line, block, true)
    }
    this.endRow(block)
  }

  /** Draws the table held back, or writes its lines as they are when it turns out not to be one or cannot fit. */
  private endTable(block: Block): void {
    if (this.table === undefined) {
      return
    }

    const lines = this.table
    this.table = undefined
    const drawn = lines.length > 1 ? drawTable(lines.join('\n'), room()) : undefined
    for (const line of drawn ?? lines) {
      if (drawn === undefined) {
        this.flow(line, block, true)
      } else {
        this.put(line, block)
      }
      this.endRow(block)
    }
  }

  private endRow(block: Block): void {
    // Blank lines get a rail too, so paragraphs stay connected
    block.output.write(this.atLineStart ? `${block.rail}\n` : '\n')
    this.atLineStart = true
    this.broken = false
    this.column = 0
  }

  /** Prose, a word at a time; the last word waits for more, unless the line has `ended`. */
  private flow(text: string, block: Block, ended: boolean): void {
    const words = wordsOf(this.word + text)
    const last = words.at(-1)
    this.word = !ended && last !== undefined && last.trim() !== '' ? last : ''
    if (this.word !== '') {
      words.pop()
    }

    for (const word of words) {
      // Where a row breaks, the spaces are left out
      if (this.column > 0 && this.column + widthOf(word) > room()) {
        this.breakRow()
      }
      if (this.broken && word.trim() === '') {
        continue
      }
      this.putRows(block.paint(word), block)
    }
  }

  /** Painted text, from where the row is, going on to new rows as it fills them: a word longer than a row is cut. */
  private putRows(text: string, block: Block): void {
    const width = room()
    for (const [i, row] of wrapRows(text, width, width - this.column).entries()) {
      if (i > 0) {
        this.breakRow()
      }
      this.put(row, block)
    }
  }

  /** The next text goes on a new row; written lazily, so a row is never left with only its rail. */
  private breakRow(): void {
    this.broken = true
    this.column = 0
  }

  private put(text: string, block: Block): void {
    if (text === '') {
      return
    }
    if (this.broken) {
      block.output.write('\n')
      this.broken = false
      this.atLineStart = true
    }
    if (this.atLineStart) {
      block.output.write(`${block.rail}  `)
      this.atLineStart = false
      this.column = 0
    }
    block.output.write(text)
    this.column += widthOf(text)
  }
}

/** Whether `line` goes on with the table so far: the delimiter row under its header, then rows with a pipe. */
function continuesTable(table: string[], line: string): boolean {
  if (table.length === 1) {
    return DELIMITER.test(line) && line.includes('|')
  }
  return line.includes('|') && line.trim() !== ''
}
