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

/** Pairwise separable splices on one base text, sorted by position. Only batch, rewrite and invert make one. */
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

/** The whole text replaced by `text`: what Write does, as a batch. */
export function rewrite(raw: string, text: string): Batch {
  return asBatch([{ start: 0, end: raw.length, text }])
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

/**
 * The inverse morphism of the version groupoid (RFC §3.3): applied to apply(raw, p), it gives back raw. Adjacent
 * splices are merged first; two adjacent deletions would otherwise invert to two inserts at one point.
 */
export function invert(raw: string, p: Batch): Batch {
  const merged: Splice[] = []
  for (const s of p) {
    const last = merged.at(-1)
    if (last?.end === s.start) {
      merged[merged.length - 1] = { start: last.start, end: s.end, text: last.text + s.text }
    } else {
      merged.push(s)
    }
  }

  let shift = 0
  const inverse = merged.map(s => {
    const start = s.start + shift
    shift += s.text.length - (s.end - s.start)
    return { start, end: start + s.text.length, text: raw.slice(s.start, s.end) }
  })
  return asBatch(inverse)
}

/** Callers have checked that the splices are separable and sorted. */
function asBatch(splices: readonly Splice[]): Batch {
  return splices as Batch
}
