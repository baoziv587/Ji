// Where the two views hold the same content. Every write to both starts on a line of each, and those two lines are
// kept as a pair of markers, which follow their lines as the scrollback is trimmed or the content reflows. A line in
// one view finds its place in the other by the last pair at or above it.

import type { IMarker } from '@xterm/headless'
import type { View } from './screen.ts'

export type Marker = Pick<IMarker, 'line' | 'isDisposed' | 'dispose'>

export class Anchors {
  private pairs: Record<View, Marker>[] = []

  /** A write to both views starts on these lines; a pair on the same lines as the last one is left out. */
  add(pair: Record<View, Marker>): void {
    const last = this.pairs.at(-1)
    if (last?.brief.line === pair.brief.line && last.full.line === pair.full.line) {
      pair.brief.dispose()
      pair.full.dispose()
      return
    }
    this.pairs.push(pair)
  }

  /**
   * The line in `to` that shows what `line` shows in `from`: as far below the last pair at or above it, short of the
   * next pair, since what lies between is one view's own; the other view's first line when no pair is at or above.
   */
  find(line: number, from: View, to: View): number {
    this.pairs = this.pairs.filter(pair => !pair.brief.isDisposed && !pair.full.isDisposed)

    // Nothing at or above it: what it shows is gone from the other view's scrollback, or came before any of it
    const index = this.pairs.findLastIndex(pair => pair[from].line <= line)
    if (index === -1) {
      return 0
    }

    const pair = this.pairs[index]
    const target = pair[to].line + (line - pair[from].line)

    const next = this.pairs[index + 1]
    if (next === undefined) {
      return target
    }

    // A prompt that redraws can leave the next pair above this one: then it is this pair's own line
    const lastBeforeNext = Math.max(pair[to].line, next[to].line - 1)
    return Math.min(target, lastBeforeNext)
  }

  clear(): void {
    this.pairs = []
  }
}
