// A fenced code block: its fences dim, its lines in color a line at a time, since a line's colors depend on all of it.

import type { PaintLine } from '../paint/highlight.ts'
import type { Flow } from './flow.ts'
import { languageOf, loadLanguage } from '../paint/highlight.ts'
import { dim } from '../paint/text.ts'

/** A fence: its backticks, and the language after them. */
const FENCE = /^ {0,3}(`{3,})\s*([^`\s]*)/

export class Code {
  private readonly flow: Flow
  /** The block in progress: the backticks that close it, and what paints its lines. */
  private block: { fence: string; paint: PaintLine } | undefined

  constructor(flow: Flow) {
    this.flow = flow
  }

  get open(): boolean {
    return this.block !== undefined
  }

  /** Opens a block if `line` is a fence; it waits for the language's grammar. */
  async start(line: string): Promise<boolean> {
    const fence = FENCE.exec(line)
    if (fence === null) {
      return false
    }

    const start = await loadLanguage(languageOf(fence[2]))
    this.block = { fence: fence[1], paint: start() }
    this.flow.row(dim(line))
    return true
  }

  /** A line in the block, or the fence that closes it. */
  add(line: string): void {
    if (this.block === undefined) {
      return
    }

    const fence = FENCE.exec(line)
    const closes = fence !== null && fence[2] === '' && fence[1].length >= this.block.fence.length
    this.flow.row(closes ? dim(line) : this.block.paint(line))
    if (closes) {
      this.block = undefined
    }
  }

  /** The text is over, and so is a block left open. */
  end(): void {
    this.block = undefined
  }
}
