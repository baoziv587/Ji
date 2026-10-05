// The output window (RFC §3.2): the first H and last T lines of a sequence, and how many there were. Clipping is a
// monoid homomorphism, of(xs ++ ys) = concat(of(xs), of(ys)), so clipping each piece as it arrives keeps exactly what
// clipping the whole would, whatever the pieces are.

export interface Clip {
  readonly head: readonly string[]
  /** The last lines, never one of the head's. */
  readonly tail: readonly string[]
  /** Lines seen, kept or not. */
  readonly total: number
}

export interface Window {
  readonly empty: Clip
  of: (lines: readonly string[]) => Clip
  /** The clip of a sequence from the clips of its two halves, in order. */
  concat: (a: Clip, b: Clip) => Clip
}

export function createWindow(head: number, tail: number): Window {
  const empty: Clip = { head: [], tail: [], total: 0 }

  /** Every kept line with its index in the whole sequence. */
  const indexed = (c: Clip, offset: number): Array<[number, string]> => [
    ...c.head.map((line, i): [number, string] => [offset + i, line]),
    ...c.tail.map((line, i): [number, string] => [offset + c.total - c.tail.length + i, line]),
  ]

  // Which half a kept line came from does not matter, only its index: that is why the homomorphism holds
  const concat = (a: Clip, b: Clip): Clip => {
    const total = a.total + b.total
    const kept = [...indexed(a, 0), ...indexed(b, a.total)]
    const tailFrom = Math.max(head, total - tail)
    return {
      head: kept.filter(([i]) => i < head).map(([, line]) => line),
      tail: kept.filter(([i]) => i >= tailFrom).map(([, line]) => line),
      total,
    }
  }

  return {
    empty,
    of: lines => ({
      head: lines.slice(0, head),
      tail: lines.slice(Math.max(head, lines.length - tail)),
      total: lines.length,
    }),
    concat,
  }
}

/** Lines seen and not kept. head.length + tail.length + omittedLines(c) = c.total, always. */
export const omittedLines = (c: Clip): number => c.total - c.head.length - c.tail.length
