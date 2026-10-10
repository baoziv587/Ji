// How much the history holds now, against where it is compacted; then what the session has spent so far, counted by
// agent/meter.ts: in short under the input line, in full on exit.

import type { ContextSize } from '../agent/meter.ts'
import { styleText } from 'node:util'
import { dimText, formatCount } from '@ji.dev/tui'
import { UsageMeter } from '../agent/meter.ts'

/** The share of the limit past which the history shows in the warning color, and then in the error color. */
const NEAR = 0.7
const FULL = 0.9

/** The meter (agent/meter.ts), with what it counted as the terminal shows it. */
export class Meter extends UsageMeter {
  /**
   * `ctx 32k/200k`, `$0.0123`, `in 48.2k · out 3.1k`, `cache 86%`, `41 tok/s`: most important first, so a narrow line
   * drops from the end. `limit` is where the history is compacted. Dim, all but a history near the limit. Empty before
   * any call has ended.
   */
  parts(limit: number): string[] {
    if (this.calls === 0) {
      return []
    }

    const { output, cost } = this.totals
    const parts = [
      `$${cost.toFixed(4)}`,
      `in ${formatCount(this.sent())} · out ${formatCount(output)}`,
      `cache ${this.hits()}%`,
    ]

    if (this.timed.ms > 0) {
      parts.push(`${this.speed()} tok/s`)
    }

    const dimmed = parts.map(dimText)
    if (this.context === undefined) {
      return dimmed
    }

    return [describeContext(this.context, limit), ...dimmed]
  }
}

/** `ctx 32k/200k`, `~` before an estimate; dim, but in the warning color near the limit, the error color nearly at it. */
function describeContext({ tokens, estimated }: ContextSize, limit: number): string {
  const text = `ctx ${estimated ? '~' : ''}${formatCount(tokens)}/${formatCount(limit)}`
  if (tokens >= limit * FULL) {
    return styleText('red', text)
  }
  if (tokens >= limit * NEAR) {
    return styleText('yellow', text)
  }
  return dimText(text)
}
