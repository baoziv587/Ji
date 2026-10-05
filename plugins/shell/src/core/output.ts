// bash's fold (RFC §5.1): chunks joined into whole lines, each cut to lineChars, kept in the window. Nothing grows with
// the output, not even a line that never ends: only as much of it is held as could be shown.

import type { Chunk, Fold } from './fold.ts'
import type { Clip } from './window.ts'
import { createWindow } from './window.ts'

export interface Budget {
  headLines: number
  tailLines: number
  /** Characters (UTF-16 units) kept of one line. */
  lineChars: number
}

export interface OutputState {
  readonly clip: Clip
  /** Each stream's line still being written, so the two never break into each other's lines. */
  readonly open: Readonly<Record<Chunk['fd'], OpenLine>>
}

export interface OutputFold extends Fold<Chunk, OutputState> {
  /** The window once the stream has ended: a last line without a newline counts too. */
  close: (kept: OutputState) => Clip
}

/** A line still being written, held only as far as it can be shown. */
interface OpenLine {
  /** Its first lineChars characters. */
  readonly start: string
  readonly length: number
  readonly endsWithCR: boolean
}

const NO_LINE: OpenLine = { start: '', length: 0, endsWithCR: false }

const ENDS_IN_HIGH_SURROGATE = /[\uD800-\uDBFF]$/

/** stdout and stderr share the window in the order they arrive, as a terminal shows them. */
export function createOutputFold({ headLines, tailLines, lineChars }: Budget): OutputFold {
  const w = createWindow(headLines, tailLines)

  const extend = (line: OpenLine, text: string): OpenLine => ({
    start: line.start + text.slice(0, lineChars - line.start.length),
    length: line.length + text.length,
    endsWithCR: text === '' ? line.endsWithCR : text.endsWith('\r'),
  })

  const finish = ({ start, length, endsWithCR }: OpenLine): string => {
    const shown = endsWithCR ? length - 1 : length
    return shorten(start.slice(0, shown), shown, lineChars)
  }

  return {
    empty: { clip: w.empty, open: { 1: NO_LINE, 2: NO_LINE } },
    step({ clip, open }, { fd, text }) {
      const [first, ...rest] = text.split('\n')
      const done: string[] = []

      let line = extend(open[fd], first)
      for (const part of rest) {
        done.push(finish(line))
        line = extend(NO_LINE, part)
      }

      return { clip: w.concat(clip, w.of(done)), open: { ...open, [fd]: line } }
    },
    close({ clip, open }) {
      const last = [open[1], open[2]].filter(line => line.length > 0).map(finish)
      return w.concat(clip, w.of(last))
    },
  }
}

/** A long line keeps its place and says how much of it is missing. */
export function truncateLine(line: string, maxChars: number): string {
  const text = line.endsWith('\r') ? line.slice(0, -1) : line
  return shorten(text, text.length, maxChars)
}

/** `start` is the line's beginning, all of it when the line fits; `length` is the whole line's. */
function shorten(start: string, length: number, maxChars: number): string {
  if (length <= maxChars) {
    return start
  }

  // Never half of a surrogate pair
  const end = ENDS_IN_HIGH_SURROGATE.test(start.slice(0, maxChars)) ? maxChars - 1 : maxChars
  return `${start.slice(0, end)} … [+${length - end} chars]`
}
