// The rows at the end of the content that show what is being waited on, drawn again in place as it changes:
//
//   │  ◐ table · 14 rows                          <- a table held back until it ends
//
//   ◐  bash(command: "pnpm test")  12s · 340 lines   <- a call that runs for a while
//   │  ✓ tests/table.test.ts (5 tests) 4ms            <- and its last lines of output
//
// Whatever else is written to the content goes where they were, and they are drawn again under it once it ends a
// line. They wait while a prompt is open, since a prompt draws itself again by moving up over its own rows.

import { stripVTControlCharacters } from 'node:util'
import { displayWidth } from '../text.ts'

/** What to show, given the spinner's frame; none to show nothing. */
export type LiveRows = (spinner: string) => string[]

/** The size of the content: rows taller than it could not be taken back. */
interface Size {
  columns: number
  rows: number
}

/** A spinner's frames, the status's too. */
export const SPINNER_FRAMES = ['◒', '◐', '◓', '◑']

export class Live {
  /** Writes to the content, to every view. */
  private readonly write: (text: string) => void
  private readonly size: () => Size
  private rows: LiveRows | undefined
  private timer: NodeJS.Timeout | undefined
  private frame = 0
  /** The rows on screen. */
  private drawn: string[] = []
  /** Questions open: the rows wait for them. */
  private paused = 0
  /** Views whose last row written is unfinished: the rows wait for it to end. */
  private readonly midLine = new Set<string>()

  constructor(write: (text: string) => void, size: () => Size) {
    this.write = write
    this.size = size
  }

  /** Shows `rows` from now on, asked again every turn of the spinner. */
  follow(rows: LiveRows): void {
    this.rows = rows
    this.timer ??= setInterval(() => {
      this.frame++
      this.tick()
    }, 80)
    this.tick()
  }

  /** Takes the rows away for good. */
  clear(): void {
    clearInterval(this.timer)
    this.timer = undefined
    this.rows = undefined
    this.write(this.erase())
  }

  /** A prompt opens: the rows go, and stay away while it is open. */
  pause(): void {
    this.paused++
    this.write(this.erase())
  }

  resume(): void {
    this.paused = Math.max(0, this.paused - 1)
    this.tick()
  }

  /** For the screen, before anything else is written: what takes the rows away. */
  erase(): string {
    if (this.drawn.length === 0) {
      return ''
    }

    // A row wider than the content, after the terminal narrowed, has wrapped on to more
    const { columns } = this.size()
    const height = this.drawn.reduce((sum, row) => sum + Math.max(1, Math.ceil(displayWidth(row) / columns)), 0)
    this.drawn = []
    return `\x1B[${height}F\x1B[J`
  }

  /** For the screen, after `text` went to `views`: what draws the rows again, once every view is at a line's start. */
  after(text: string, views: readonly string[]): string {
    const shown = stripVTControlCharacters(text)
    if (shown !== '') {
      const ended = shown.endsWith('\n')
      for (const view of views) {
        if (ended) {
          this.midLine.delete(view)
        } else {
          this.midLine.add(view)
        }
      }
    }
    return this.draw()
  }

  private tick(): void {
    const rows = this.current()
    if (rows.join('\n') !== this.drawn.join('\n')) {
      this.write(this.erase() + this.draw())
    }
  }

  private draw(): string {
    if (this.drawn.length > 0 || this.midLine.size > 0) {
      return ''
    }

    this.drawn = this.current()
    return this.drawn.map(row => `${row}\n`).join('')
  }

  /** The rows to show now; none while a prompt is open. Short of the content's height, so all of them can go back. */
  private current(): string[] {
    const room = this.size().rows - 1
    if (this.rows === undefined || this.paused > 0 || room < 1) {
      return []
    }
    return this.rows(SPINNER_FRAMES[this.frame % SPINNER_FRAMES.length]).slice(0, room)
  }
}
