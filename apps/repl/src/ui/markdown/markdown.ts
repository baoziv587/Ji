// A reply's Markdown as it streams in, in rows that fit the terminal. ASCII stand-ins for the real glyphs:
//
//   # Title                  Title          bold and underlined; the #s are left out          line.ts
//   ## Part                  Part           bold
//   - item                   * item         rows it wraps on to line up under its text
//     - nested                 o nested     a marker for each depth
//   1. step                  1. step
//   - [x] done               v done         a task's box for its marker
//   > quoted                 | quoted       a gray bar before each row, and dim text
//   ---                      ------------   a dim rule across the width
//   **bold** `code`          bold code      inline marks, once they close                      inline.ts
//   ```ts                    ```ts          code in color, a line at a time                    code.ts
//   | a | b |                +---+---+      a table, drawn once it ends                        table.ts
//
// Each kind of block handles its own lines; this only says whose a line is. Rows are laid out by flow.ts.

import type { Rows } from './flow.ts'
import { room } from '../paint/text.ts'
import { Code } from './code.ts'
import { Flow } from './flow.ts'
import { Line } from './line.ts'
import { Table } from './table.ts'

/**
 * A line held back whole: one that may still turn out to be a fence, a table's first or a rule; or that has shown only
 * marks so far, so may still turn out a heading, an item or a quote.
 */
const HOLD = /^ {0,3}(?:`{0,3}$|```|\|)|^[\s>#*+\-_\d.)[\]x]*$/i

/**
 * Writes the Markdown streamed to it as rows, at most `width` columns each. A line goes to the line of text, the code
 * block or the table: a line of text as soon as its start shows it is one, the others once the line has ended.
 */
export class Markdown {
  private readonly flow: Flow
  private readonly line: Line
  private readonly code: Code
  private readonly table: Table
  /** The line in progress, while it is held back. */
  private held = ''

  constructor(rows: Rows, width: () => number = room) {
    this.flow = new Flow(rows, width)
    this.line = new Line(this.flow, width)
    this.code = new Code(this.flow)
    this.table = new Table(this.flow, width, line => this.line.write(line))
  }

  async write(chunk: string): Promise<void> {
    for (const [i, part] of chunk.split('\n').entries()) {
      if (i > 0) {
        await this.endLine()
      }
      this.add(part)
    }
  }

  /** What is held back for long, for the status: `table · 14 rows`; empty while the text goes on as it comes. */
  describe(): string {
    return this.table.describe()
  }

  /** The text has ended: what is held back is written as it is, and a table is drawn. */
  end(): void {
    const line = this.held
    this.held = ''
    if (this.line.open) {
      this.line.end()
    } else if (this.code.open) {
      if (line !== '') {
        this.code.add(line)
      }
    } else if (line !== '' && !this.table.add(line)) {
      this.table.end()
      this.line.write(line)
    }

    this.table.end()
    this.code.end()
    this.line.reset()
    this.flow.end()
  }

  private add(part: string): void {
    if (this.line.open) {
      this.line.add(part)
      return
    }

    const line = this.held + part
    if (this.code.open || this.table.open || HOLD.test(line)) {
      this.held = line
      return
    }
    this.held = ''
    this.line.start(line)
  }

  private async endLine(): Promise<void> {
    const line = this.held
    this.held = ''

    if (this.line.open) {
      this.line.end()
    } else if (this.code.open) {
      this.code.add(line)
    } else if (!this.table.add(line)) {
      this.table.end()
      if (!(await this.code.start(line)) && !this.table.start(line)) {
        this.line.write(line)
      }
    }
  }
}
