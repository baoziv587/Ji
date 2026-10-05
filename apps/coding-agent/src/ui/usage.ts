// What the session has spent so far: tokens in and out, cache hits, speed and cost. In short on the line above the
// status, in full on exit.

import type { Usage, UsageTotals } from '@ji.dev/llm'
import { formatCount } from '@ji.dev/tui'

/**
 * Adds up every model call of the session as it ends: plugin calls, failed ones and those of a stopped reply too,
 * since the provider bills them all. Speed counts only the calls timed with start(): the main model's, which stream.
 */
export class Meter {
  private totals: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }
  private calls = 0

  /** Output tokens and the time they took, from each call's first streamed token (or its start, if none streams). */
  private timed = { tokens: 0, ms: 0 }
  /** When the call being timed started, or streamed its first token; undefined while none is. */
  private from: number | undefined
  private streamed = false

  /** A main-model call starts, to be timed. */
  start(): void {
    this.from = performance.now()
    this.streamed = false
  }

  /** It streams thinking or text: the wait for the first token is left out of its time. */
  streaming(): void {
    if (!this.streamed) {
      this.from = performance.now()
      this.streamed = true
    }
  }

  /** A call ended; if it was started, its tokens and time count toward the speed. */
  end(usage: Usage): void {
    this.add(usage)

    if (this.from !== undefined) {
      this.timed.tokens += usage.output
      this.timed.ms += performance.now() - this.from
      this.from = undefined
    }
  }

  /** A call failed or was cancelled: what the provider billed, if anything, still counts, but not toward the speed. */
  dropped(usage?: Usage): void {
    this.from = undefined

    if (usage !== undefined) {
      this.add(usage)
    }
  }

  private add(usage: Usage): void {
    this.calls++
    this.totals = {
      input: this.totals.input + usage.input,
      output: this.totals.output + usage.output,
      cacheRead: this.totals.cacheRead + usage.cacheRead,
      cacheWrite: this.totals.cacheWrite + usage.cacheWrite,
      cost: this.totals.cost + usage.cost.total,
    }
  }

  /**
   * `in 48.2k · out 3.1k`, `cache 86%`, `41 tok/s`, `$0.0123`: most important first, so a narrow line drops from the
   * end. Empty before any call has ended.
   */
  parts(): string[] {
    if (this.calls === 0) {
      return []
    }

    const { output, cost } = this.totals
    const parts = [`in ${formatCount(this.sent())} · out ${formatCount(output)}`, `cache ${this.hits()}%`]

    if (this.timed.ms > 0) {
      parts.push(`${this.speed()} tok/s`)
    }

    parts.push(`$${cost.toFixed(4)}`)
    return parts
  }

  /** The whole session for the exit, every token counted: `48,213 in (86% cached) · 3,104 out · 12 model calls · …`. */
  summary(): string {
    if (this.calls === 0) {
      return 'No model calls'
    }

    const { output, cost } = this.totals
    const calls = this.calls === 1 ? '1 model call' : `${this.calls} model calls`
    const parts = [`${exact(this.sent())} in (${this.hits()}% cached)`, `${exact(output)} out`, calls]

    if (this.timed.ms > 0) {
      parts.push(`${this.speed()} tok/s`)
    }

    parts.push(`$${cost.toFixed(4)}`)
    return `Tokens: ${parts.join(' · ')}`
  }

  /** pi-ai's input excludes cache hits, so what the model was sent is all three. */
  private sent(): number {
    const { input, cacheRead, cacheWrite } = this.totals
    return input + cacheRead + cacheWrite
  }

  /** The share of what was sent that came from the cache, in percent. */
  private hits(): number {
    const sent = this.sent()
    return sent === 0 ? 0 : Math.round((this.totals.cacheRead / sent) * 100)
  }

  private speed(): number {
    return Math.round((this.timed.tokens / this.timed.ms) * 1000)
  }
}

/** Every digit, grouped by thousands: `48,213`. */
function exact(n: number): string {
  return n.toLocaleString('en-US')
}
