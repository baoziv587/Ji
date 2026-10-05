// What the model reads (RFC §6): the output, then one line that says how it ended. The omission marker and that line
// are never cut. Machine-readable fields go in details, which the model never sees.

import type { Found } from './core/ripgrep.ts'
import type { Clip } from './core/window.ts'
import type { Outcome } from './exec.ts'
import { omittedLines } from './core/window.ts'

export interface Rendered {
  text: string
  details: Record<string, unknown>
  isError: boolean
}

/** bash's result. `log` is where the whole output was kept, when lines were left out. */
export function renderOutput(clip: Clip, outcome: Outcome, ms: number, log?: string): Rendered {
  const omitted = omittedLines(clip)
  const marker =
    log === undefined
      ? `[… ${count(omitted, 'line')} omitted …]`
      : `[… ${count(omitted, 'line')} omitted; full output: ${log} …]`
  const output = clip.total === 0 ? ['(no output)'] : [...clip.head, ...(omitted > 0 ? [marker] : []), ...clip.tail]

  return {
    text: [...output, statusLine(outcome, ms)].join('\n'),
    details: { outcome, ms, lines: { total: clip.total, omitted }, ...(log === undefined ? {} : { log }) },
    isError: !(outcome.kind === 'exit' && outcome.code === 0),
  }
}

/** grep's result: one line per hit, then the count. More is said only once the match after the limit was seen. */
export function renderFound(found: Found, limit: number): Rendered {
  const matches = Math.min(found.matches, limit)
  const more = found.matches > limit
  if (matches === 0) {
    return { text: 'No matches.', details: { matches, more }, isError: false }
  }

  const lines = found.hits.map(hit => {
    const mark = hit.match ? ':' : '-'
    return `${hit.path.replace(/^\.\//, '')}${mark}${hit.line}${mark} ${hit.text}`
  })
  const total = more
    ? `[first ${count(matches, 'matching line')}; there are more. Narrow the pattern, path or glob.]`
    : `[${count(matches, 'matching line')}]`

  return { text: [...lines, total].join('\n'), details: { matches, more }, isError: false }
}

/** A failure the model should see as a result, with what to do next in `text`. */
export function failure(text: string, code: string): Rendered {
  return { text, details: { errors: [{ code }] }, isError: true }
}

/** The clock that stopped a command, as the status line says it. */
const STOPPED_BY: Record<'total' | 'idle', (seconds: number) => string> = {
  total: seconds => `timed out after ${seconds}s`,
  idle: seconds => `no output for ${seconds}s`,
}

function statusLine(outcome: Outcome, ms: number): string {
  const took = `${(ms / 1000).toFixed(1)}s`
  switch (outcome.kind) {
    case 'exit':
      return `[exit ${outcome.code} · ${took}]`
    case 'signal':
      return `[killed by ${outcome.signal} · ${took}]`
    case 'timeout':
      return `[${STOPPED_BY[outcome.clock](outcome.ms / 1000)} and was killed; the output above is partial · ${took}]`
  }
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}
