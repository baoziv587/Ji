// Splices on one base text form a partial commutative monoid (RFC §3.1): ∅ is the unit, joining is the disjoint union,
// defined only when every pair is separable. Positions are UTF-16 offsets into the raw text, BOM and CRLF included.

import type { Result } from './result.ts'
import { err, ok } from './result.ts'

/** Half-open: [start, end). */
export interface Range {
  start: number
  end: number
}

export interface Splice extends Range {
  text: string
}

declare const separableSplices: unique symbol

/** Pairwise separable splices on one base text, sorted by position. Only batch makes one. */
export type Batch = readonly Splice[] & { readonly [separableSplices]: true }

/** Indices, into the array given to batch, of two splices that cannot both apply. */
export type Overlap = [number, number]

/**
 * Two ranges may both be replaced when they do not overlap and an empty one touches nothing: two inserts at one point
 * would apply in either order with different results, so they are the one case that does not commute.
 */
export function separable(a: Range, b: Range): boolean {
  if (a.start === a.end || b.start === b.end) {
    return a.end < b.start || b.end < a.start
  }
  return a.end <= b.start || b.end <= a.start
}

/** The join of the monoid; every pair that cannot join is reported, not just the first. */
export function batch(splices: readonly Splice[]): Result<Batch, Overlap[]> {
  const order = splices
    .map((_, i) => i)
    .sort((i, j) => splices[i].start - splices[j].start || splices[i].end - splices[j].end)
  const overlaps: Overlap[] = []

  for (let a = 0; a < order.length; a++) {
    for (let b = a + 1; b < order.length; b++) {
      const [i, j] = [order[a], order[b]]
      // Sorted by start: a splice that starts past the end of i, and every one after it, cannot touch i
      if (splices[j].start > splices[i].end) {
        break
      }
      if (!separable(splices[i], splices[j])) {
        overlaps.push(i < j ? [i, j] : [j, i])
      }
    }
  }

  return overlaps.length > 0 ? err(overlaps) : ok(asBatch(order.map(i => splices[i])))
}

export function apply(raw: string, p: Batch): string {
  let out = ''
  let pos = 0
  for (const s of p) {
    out += raw.slice(pos, s.start) + s.text
    pos = s.end
  }
  return out + raw.slice(pos)
}

/** Callers have checked that the splices are separable and sorted. */
function asBatch(splices: readonly Splice[]): Batch {
  return splices as Batch
}
