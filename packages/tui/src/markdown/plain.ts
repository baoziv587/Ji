// Text as it streams in, in rows that fit: what Markdown does, without the Markdown.

import type { Rows } from './flow.ts'
import type { Format } from './inline.ts'
import { Flow } from './flow.ts'

/** Writes the text streamed to it in `formats`, broken between words into rows at most `width` columns each. */
export class PlainText {
  private readonly flow: Flow
  private readonly formats: Format[]

  constructor(rows: Rows, width: () => number, formats: Format[] = []) {
    this.flow = new Flow(rows, width)
    this.formats = formats
  }

  async write(chunk: string): Promise<void> {
    for (const [i, part] of chunk.split('\n').entries()) {
      if (i > 0) {
        this.flow.endLine()
      }
      this.flow.add(part, this.formats)
    }
  }

  end(): void {
    this.flow.end()
  }
}
