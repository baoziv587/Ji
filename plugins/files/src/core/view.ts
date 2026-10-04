// Matching runs on a quotient of the raw text, where CRLF and LF are the same (RFC §5.2). The view maps every match back
// to raw offsets, so the BOM and every line ending outside the replaced ranges stay byte for byte.

import type { Range } from './batch.ts'

export interface TextView {
  readonly raw: string
  /** What old_text is matched against: raw without the BOM, CRLF written as LF. */
  readonly text: string
  /** Offsets in `text` to offsets in `raw`; a range never splits a CRLF. */
  toRaw: (r: Range) => Range
  /** new_text in the line ending of the raw range it replaces: see eolOf. */
  adapt: (text: string, at: Range) => string
}

const strict = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const encoder = new TextEncoder()

/** Strict UTF-8 text, BOM kept, or undefined for anything else (invalid UTF-8, or a NUL, which marks binary). */
export function decode(bytes: Uint8Array): string | undefined {
  try {
    const raw = strict.decode(bytes)
    return raw.includes('\0') ? undefined : raw
  } catch {
    return undefined
  }
}

/** Inverse of decode: valid UTF-8 has one encoding, so encode(decode(b)) is b. */
export function encode(raw: string): Uint8Array {
  return encoder.encode(raw)
}

export function view(raw: string): TextView {
  const bom = raw.startsWith('﻿') ? 1 : 0
  const body = raw.slice(bom)

  // Text offset of each LF that stands for a CRLF, ascending
  const crlf: number[] = []
  const parts: string[] = []
  let from = 0
  for (let i = body.indexOf('\r\n'); i !== -1; i = body.indexOf('\r\n', i + 2)) {
    parts.push(body.slice(from, i))
    crlf.push(i - crlf.length)
    from = i + 1
  }
  parts.push(body.slice(from))

  const toRawOffset = (i: number): number => bom + i + countBelow(crlf, i)
  let dominant: string | undefined

  /**
   * The style of the first line break inside the range; else the file's most common one; LF on a tie or when the file
   * has no line break.
   */
  function eolOf(at: Range): string {
    const lf = raw.indexOf('\n', at.start)
    if (lf !== -1 && lf < at.end) {
      return raw[lf - 1] === '\r' ? '\r\n' : '\n'
    }
    dominant ??= crlf.length > countOf(raw, '\n') - crlf.length ? '\r\n' : '\n'
    return dominant
  }

  return {
    raw,
    text: parts.join(''),
    toRaw: r => ({ start: toRawOffset(r.start), end: toRawOffset(r.end) }),
    adapt: (text, at) => {
      const lf = text.replaceAll('\r\n', '\n')
      return lf.includes('\n') ? lf.replaceAll('\n', eolOf(at)) : lf
    },
  }
}

/** How many sorted values are below `x`. */
function countBelow(sorted: readonly number[], x: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (sorted[mid] < x) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  return lo
}

function countOf(s: string, c: string): number {
  let n = 0
  for (let i = s.indexOf(c); i !== -1; i = s.indexOf(c, i + 1)) {
    n++
  }
  return n
}
