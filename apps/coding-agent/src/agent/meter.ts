// How much the history holds now, against where it is compacted; then what the session has spent so far: cost, tokens
// in and out, cache hits and speed. Counted from a reply's events in a session of the service, which sends what it
// counted to its clients (ui/usage.ts shows it in the terminal).

import type { RunEvent, Usage, UsageTotals } from '@ji.dev/llm'

/** The history's tokens, and whether they are an estimate or the provider's count. */
export interface ContextSize {
  tokens: number
  estimated: boolean
}

/** What a meter has counted, as a client shows it. */
export interface UsageReading {
  /** The history's size, and where it is compacted; none until the main model has answered once. */
  context?: ContextSize & { limit: number }
  cost: number
  /** What the model was sent, cache hits included. */
  input: number
  output: number
  /** The share of what was sent that came from the cache, in percent. */
  cache: number
  /** Output tokens a second, of the main model's calls; none until one is timed. */
  speed?: number
  calls: number
}

/**
 * Adds up every model call of the session as it ends: plugin calls, failed ones and those of a stopped reply too,
 * since the provider bills them all. Speed counts only the calls timed with start(): the main model's, which stream.
 */
export class UsageMeter {
  private totals: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }
  private calls = 0

  /** Output tokens and the time they took, from each call's first streamed token (or its start, if none streams). */
  private timed = { tokens: 0, ms: 0 }
  /** When the call being timed started, or streamed its first token; undefined while none is. */
  private from: number | undefined
  private streamed = false

  /** The history's tokens; undefined until the main model has answered once. */
  private context: ContextSize | undefined

  /**
   * Counts what a reply's event says it spent. `timed` false for events read back from a log, which happened at
   * another time: they count, but not toward the speed.
   */
  take(e: RunEvent, timed = true): void {
    switch (e.type) {
      case 'model_start':
        if (e.by === undefined && timed) {
          this.start()
        }
        break
      case 'compaction:end':
        if (e.error === undefined) {
          this.compacted(e.after)
        }
        break
      case 'thinking':
      case 'text':
      case 'tool_call_delta':
        this.streaming()
        break
      case 'model_end':
        this.end(e.message.usage)
        if (e.by === undefined) {
          this.measured(e.message.usage)
        }
        break
      case 'model_error':
        this.dropped(e.usage)
        break
      case 'step_cancelled':
        this.dropped()
        break
    }
  }

  /** A main-model call starts, to be timed. */
  start(): void {
    this.from = performance.now()
    this.streamed = false
  }

  /** It streams thinking or text: the wait for the first token is left out of its time. */
  streaming(): void {
    if (!this.streamed && this.from !== undefined) {
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

  /** The main model answered: what it was sent and wrote is the history now, as the provider counted it. */
  measured(usage: Usage): void {
    this.context = {
      tokens: usage.input + usage.cacheRead + usage.cacheWrite + usage.output,
      estimated: false,
    }
  }

  /** The history became a summary: an estimate until the main model counts it. */
  compacted(tokens: number): void {
    this.context = { tokens, estimated: true }
  }

  /** A call failed or was cancelled: what the provider billed, if anything, still counts, but not toward the speed. */
  dropped(usage?: Usage): void {
    this.from = undefined

    if (usage !== undefined) {
      this.add(usage)
    }
  }

  /** What has been counted; `limit` is where the history is compacted. */
  reading(limit: number): UsageReading {
    return {
      context: this.context === undefined ? undefined : { ...this.context, limit },
      cost: this.totals.cost,
      input: this.sent(),
      output: this.totals.output,
      cache: this.hits(),
      speed: this.timed.ms > 0 ? this.speed() : undefined,
      calls: this.calls,
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
