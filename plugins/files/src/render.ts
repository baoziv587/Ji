// What the model reads: a short line, then the diff or one line per error with what to do next (RFC §6.1).
// Machine-readable fields go in details, which the model never sees.

import type { Applied, Prepared } from './commit.ts'
import type { Result } from './core/result.ts'
import type { EditError } from './transform.ts'
import { structuredPatch } from 'diff'

/** The diff is cut after this many lines; counts and error codes never are. */
const MAX_DIFF_LINES = 200

export interface Rendered {
  text: string
  details: Record<string, unknown>
  isError: boolean
}

/** `shown` is the path as the model wrote it; details carry the file's identity. */
export function render(result: Result<Applied, EditError[]>, shown: string): Rendered {
  if (result.ok) {
    const { path, version } = result.value
    return { text: applied(result.value, shown), details: { path, version }, isError: false }
  }

  const lines = result.error.map(e => explain(e, shown))
  const text = [`Edit failed; ${shown} is unchanged.`, ...lines, ...similar(result.error)].join('\n')
  return { text, details: { errors: result.error }, isError: true }
}

/** Hunks without context lines, numbered as in the file before and after. */
export function diff(prepared: Prepared): string {
  const out = hunksOf(prepared).flatMap(h => [
    `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`,
    ...h.lines,
  ])
  return out.length > MAX_DIFF_LINES
    ? [...out.slice(0, MAX_DIFF_LINES), '… (diff truncated)'].join('\n')
    : out.join('\n')
}

function hunksOf({ base, next }: Prepared): ReturnType<typeof structuredPatch>['hunks'] {
  return structuredPatch('', '', base, next, '', '', { context: 0, stripTrailingCr: true }).hunks
}

/** What a change does, before it is written: `Edit x (+2 -1)`, or `Create x (12 lines)` for a new file. */
export function summary(p: Prepared, shown: string): string {
  return `${p.expected === 'absent' ? 'Create' : 'Edit'} ${shown} ${size(p)}`
}

function applied(a: Applied, shown: string): string {
  return a.expected === 'absent' ? `Created ${shown} ${size(a)}.` : `Edited ${shown} ${size(a)}.\n${diff(a)}`
}

function size(p: Prepared): string {
  if (p.expected === 'absent') {
    const lines = lineCount(p.next)
    return `(${lines} line${lines === 1 ? '' : 's'})`
  }
  const changed = hunksOf(p).flatMap(h => h.lines)
  const added = changed.filter(l => l.startsWith('+')).length
  const removed = changed.filter(l => l.startsWith('-')).length
  return `(+${added} -${removed})`
}

function explain(e: EditError, shown: string): string {
  switch (e.code) {
    case 'INVALID_INPUT':
      return e.edit === undefined ? e.message : `edits[${e.edit}]: ${e.message}.`
    case 'MATCH_COUNT':
      return matchCount(e)
    case 'OVERLAP':
      return e.edits[0] === e.edits[1]
        ? `edits[${e.edits[0]}]: its matches overlap each other; use a longer old_text.`
        : `edits[${e.edits[0]}] and edits[${e.edits[1]}] overlap; merge them into one edit.`
    case 'NO_CHANGE':
      return 'The change leaves the file as it is.'
    case 'STALE_VERSION':
      if (e.expected === 'absent') {
        return `${shown} exists and you have not read it. Read it before changing it.`
      }
      return e.current === 'absent'
        ? `${shown} no longer exists.`
        : 'The file is not at the version you last read: it changed, or an earlier write of yours went through. Read it again before changing it.'
    case 'UNSUPPORTED_FILE':
    case 'PATH_DENIED':
      return `${e.message}.`
  }
}

function matchCount(e: Extract<EditError, { code: 'MATCH_COUNT' }>): string {
  const head = `edits[${e.edit}]: `
  if (e.found === 0) {
    return `${head}old_text not found; expected ${e.expected}. Read the file again and copy old_text exactly.`
  }
  const where = `${e.found} time${e.found === 1 ? '' : 's'} (line${e.lines.length === 1 ? '' : 's'} ${e.lines.join(', ')}${e.found > e.lines.length ? ', …' : ''})`
  const fix =
    e.expected === 1
      ? 'Include nearby lines so it matches only once.'
      : 'Check every match, then fix count or split it into separate edits.'
  return `${head}old_text occurs ${where}; expected ${e.expected}. ${fix}`
}

/** Where text like a missing old_text is. Only shown: nothing here was applied. */
function similar(errors: readonly EditError[]): string[] {
  const lines = errors.flatMap(e =>
    e.code === 'MATCH_COUNT' ? (e.hints ?? []).map(h => `  edits[${e.edit}], line ${h.line}: ${h.reason}`) : [],
  )
  return lines.length > 0 ? ['Similar text (not applied):', ...lines, 'Read those lines and copy them exactly.'] : []
}

/** A final line break does not start another line. */
function lineCount(s: string): number {
  return (s.match(/\n/g)?.length ?? 0) + (s === '' || s.endsWith('\n') ? 0 : 1)
}
