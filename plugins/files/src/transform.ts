// A Transform is all a file tool brings: the file's new text, from its current text (RFC §3.3). It names no positions
// and no version, so it runs on whatever text it is given, and transforms compose with chain.

import type { Edit, PlanError } from './core/plan.ts'
import type { Result } from './core/result.ts'
import type { Candidate, Hinter } from './hints.ts'
import type { Expected } from './workspace.ts'
import { apply } from './core/batch.ts'
import { plan } from './core/plan.ts'
import { err, ok } from './core/result.ts'
import { view } from './core/view.ts'

/** `text` is the decoded file, '' when it does not exist. */
export type Transform = (text: string) => Result<string, EditError[]>

type MatchCount = Extract<PlanError, { code: 'MATCH_COUNT' }>

export type EditError =
  | Exclude<PlanError, MatchCount>
  /** `hints`: where similar text is, when old_text occurs nowhere. Shown to the model, never applied. */
  | (MatchCount & { hints?: Candidate[] })
  | { code: 'NO_CHANGE' }
  /** `current` is missing when publish found the file changed: it does not say to what. */
  | { code: 'STALE_VERSION'; expected: Expected; current?: Expected }
  | { code: 'UNSUPPORTED_FILE' | 'PATH_DENIED'; message: string }

/** Replacements, each matched against the same text. */
export function editTransform(edits: readonly Edit[], hinters: readonly Hinter[] = []): Transform {
  return text => {
    const v = view(text)
    const planned = plan(v, edits)
    if (planned.ok) {
      return ok(apply(text, planned.value))
    }
    return err(
      planned.error.map(e => (isMiss(e) ? withHints(e, hintsFor(v.text, edits[e.edit].old_text, hinters)) : e)),
    )
  }
}

/** The whole file replaced by `content`. */
export function writeTransform(content: string): Transform {
  return () => ok(content)
}

/** Each transform runs on the text the one before it returned; the first error stops the chain. chain() changes nothing. */
export function chain(...transforms: readonly Transform[]): Transform {
  return text => transforms.reduce<Result<string, EditError[]>>((r, f) => (r.ok ? f(r.value) : r), ok(text))
}

function isMiss(e: PlanError): e is MatchCount {
  return e.code === 'MATCH_COUNT' && e.found === 0
}

function withHints(e: MatchCount, hints: Candidate[]): EditError {
  return hints.length > 0 ? { ...e, hints } : e
}

/** Every hinter's candidates, one per line: the first hinter to report a line gives its reason. */
function hintsFor(text: string, needle: string, hinters: readonly Hinter[]): Candidate[] {
  const byLine = new Map<number, Candidate>()
  for (const candidate of hinters.flatMap(h => h(text, needle))) {
    if (!byLine.has(candidate.line)) {
      byLine.set(candidate.line, candidate)
    }
  }
  return [...byLine.values()]
}
