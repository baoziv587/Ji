// What the model reads: a short line, then the diff or one line per error with what to do next (RFC §6.1).
// Machine-readable fields go in details, which the model never sees.

import type { EditError, Outcome, Prepared } from './commit.ts'
import { structuredPatch } from 'diff'
import { lineAt } from './core/plan.ts'

/** The diff is cut after this many lines; counts, states and error codes never are. */
const MAX_DIFF_LINES = 200

export interface Rendered {
  text: string
  details: Record<string, unknown>
  isError: boolean
}

/** `shown` is the path as the model wrote it; details carry the absolute one. */
export function render(outcome: Outcome, shown: string, mode: 'edit' | 'write'): Rendered {
  switch (outcome.state) {
    case 'applied': {
      const { prepared, version } = outcome
      const details = {
        commit_state: 'applied',
        path: prepared.path,
        version,
        version_before: prepared.version,
        replacements: prepared.batch.length,
        lines: prepared.batch.map(s => lineAt(prepared.base, s.start)),
      }
      return { text: applied(prepared, shown, mode), details, isError: false }
    }
    case 'not_applied': {
      const lines = outcome.errors.map(e => explain(e, shown))
      const text = [`Edit failed; ${shown} is unchanged.`, ...lines].join('\n')
      return { text, details: { commit_state: 'not_applied', errors: outcome.errors }, isError: true }
    }
    case 'unknown': {
      const text = `The write to ${shown} may or may not have happened (${String(outcome.error)}). Read the file to check before trying again.`
      return { text, details: { commit_state: 'unknown', path: outcome.prepared.path }, isError: true }
    }
  }
}

/** Hunks without context lines, numbered as in the file before and after. */
export function diff(prepared: Prepared): string {
  const { hunks } = structuredPatch('', '', prepared.base, prepared.next, '', '', { context: 0, stripTrailingCr: true })
  const out = hunks.flatMap(h => [`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`, ...h.lines])
  return out.length > MAX_DIFF_LINES
    ? [...out.slice(0, MAX_DIFF_LINES), '… (diff truncated)'].join('\n')
    : out.join('\n')
}

function applied(prepared: Prepared, shown: string, mode: 'edit' | 'write'): string {
  if (mode === 'write') {
    const lines = lineCount(prepared.next)
    return `${prepared.version === 'absent' ? 'Created' : 'Rewrote'} ${shown} (${lines} line${lines === 1 ? '' : 's'}).`
  }
  const n = prepared.batch.length
  return `Edited ${shown} (${n} replacement${n === 1 ? '' : 's'}).\n${diff(prepared)}`
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
      return 'The edits leave the file as it is.'
    case 'NOT_OBSERVED':
      return `Read ${shown} before editing it.`
    case 'STALE_VERSION':
      if (e.expected === 'absent') {
        return `${shown} already exists. Read it before rewriting it, or edit it instead.`
      }
      return e.current === undefined
        ? `${shown} no longer exists.`
        : 'The file changed after you last read it. Read it again before editing.'
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

/** A final line break does not start another line. */
function lineCount(s: string): number {
  return (s.match(/\n/g)?.length ?? 0) + (s === '' || s.endsWith('\n') ? 0 : 1)
}
