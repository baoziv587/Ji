// plan turns text edits, which search, into a batch of splices, which do not (RFC §5.1). Every edit is matched against
// the same original text, so the result does not depend on the order of the edits (RFC §3.2).

import type { Batch, Range, Splice } from './batch.ts'
import type { Result } from './result.ts'
import type { TextView } from './view.ts'
import { batch } from './batch.ts'
import { err } from './result.ts'

export interface Edit {
  old_text: string
  new_text: string
  /** How many times old_text must occur. Default 1: it must be unique. */
  count?: number
}

export type PlanError =
  | { code: 'INVALID_INPUT'; edit?: number; message: string }
  | { code: 'MATCH_COUNT'; edit: number; expected: number; found: number; lines: number[] }
  | { code: 'OVERLAP'; edits: [number, number] }

/** At most this many line numbers per MATCH_COUNT. */
const MAX_LINES = 10

/** Every occurrence, overlapping ones included. */
function locate(text: string, needle: string): Range[] {
  const found: Range[] = []
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) {
    found.push({ start: i, end: i + needle.length })
  }
  return found
}

export function plan(v: TextView, edits: readonly Edit[]): Result<Batch, PlanError[]> {
  const errors: PlanError[] = []
  const splices: Splice[] = []
  const owner: number[] = []

  edits.forEach((e, i) => {
    const invalid = invalidEdit(e)
    if (invalid !== undefined) {
      errors.push({ code: 'INVALID_INPUT', edit: i, message: invalid })
      return
    }

    const expected = e.count ?? 1
    const found = locate(v.text, e.old_text.replaceAll('\r\n', '\n'))
    if (found.length !== expected) {
      const lines = found.slice(0, MAX_LINES).map(r => lineAt(v.text, r.start))
      errors.push({ code: 'MATCH_COUNT', edit: i, expected, found: found.length, lines })
      return
    }

    for (const r of found) {
      const at = v.toRaw(r)
      splices.push({ ...at, text: v.adapt(e.new_text, at) })
      owner.push(i)
    }
  })

  // Overlaps among the edits that matched are reported too, so one call reports every error at once
  const joined = batch(splices)
  if (joined.ok) {
    return errors.length > 0 ? err(errors) : joined
  }

  const pairs = new Map<string, PlanError>()
  for (const [a, b] of joined.error) {
    const edits = [owner[a], owner[b]].sort((x, y) => x - y) as [number, number]
    pairs.set(edits.join(), { code: 'OVERLAP', edits })
  }
  return err([...errors, ...pairs.values()])
}

/** 1-based line of a text offset. */
function lineAt(text: string, offset: number): number {
  let line = 1
  for (let i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) {
    line++
  }
  return line
}

function invalidEdit(e: Edit): string | undefined {
  if (e.old_text === '') {
    return 'old_text must not be empty; to insert, include the text next to the insertion point'
  }
  if (!e.old_text.isWellFormed() || !e.new_text.isWellFormed()) {
    return 'old_text and new_text must be valid Unicode'
  }
  if (e.count !== undefined && !(Number.isInteger(e.count) && e.count >= 1)) {
    return 'count must be a positive integer'
  }
  return undefined
}
