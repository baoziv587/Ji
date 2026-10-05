// What the reply is doing and for how long, spun in the bottom bar while a reply runs.

import { styleText } from 'node:util'
import { dim } from '../paint/text.ts'

export class Status {
  private static readonly frames = ['◒', '◐', '◓', '◑']
  /** Draws the bar again, to spin the icon and count the seconds. */
  private readonly draw: () => void
  private timer: NodeJS.Timeout | undefined
  private label = ''
  private detail = ''
  private since = 0
  private frame = 0

  constructor(draw: () => void) {
    this.draw = draw
  }

  /** A different label starts its own count; the detail, a tool's progress say, does not. */
  show(label: string, detail = ''): void {
    if (label !== this.label) {
      this.label = label
      this.since = performance.now()
    }
    this.detail = detail
    this.timer ??= setInterval(() => {
      this.frame++
      this.draw()
    }, 80)
    this.draw()
  }

  hide(): void {
    clearInterval(this.timer)
    this.timer = undefined
    this.label = ''
    this.draw()
  }

  /** `◐ Running calc 2s`, or empty while hidden. */
  describe(): string {
    if (this.timer === undefined) {
      return ''
    }

    const icon = styleText('magenta', Status.frames[this.frame % Status.frames.length])
    const seconds = Math.floor((performance.now() - this.since) / 1000)
    const detail = this.detail === '' ? '' : ` · ${this.detail}`
    return `${icon} ${this.label} ${dim(`${seconds}s`)}${detail}`
  }
}
