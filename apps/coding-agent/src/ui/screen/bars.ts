// The two bars around the conversation. On top, the model and its settings; at the bottom, the session's usage, the
// status line and the input line with the cursor in it. Both keep a blank row at the terminal's edge and a column on
// each side of their text; only the rules run across.

import type { Hint } from '../paint/text.ts'
import type { Editing } from './editing.ts'
import type { Frame, View } from './screen.ts'
import { styleText } from 'node:util'
import { dim, fit, hint, hints, tail, widthOf } from '../paint/text.ts'
import { textOf } from './editing.ts'

/** What the bars show, read again for every draw. */
export interface Bars {
  /** `deepseek/deepseek-v4-flash` */
  model: string
  thinking: string
  /** `~/projects/app`: the home folder as `~`. */
  root: string
  editing: Editing
  /** A reply is being written. */
  replying: boolean
  /** A question is on screen: the keys are its own. */
  asking: boolean
  /** The steers not yet delivered. */
  queued: number
  /** The session's usage so far, most important first. */
  usage: string[]
  /** What the reply is doing and for how long; empty while none runs. */
  status: string
  view: View
  /** The lines below the screen, scrolled past. */
  below: number
  /** The mode, described. */
  mode: string
  /** The less careful mode, so it stands out in the warning color. */
  auto: boolean
  /** What a yes allowed; empty while nothing is. */
  allowed: string
}

export function frameOf(columns: number, bars: Bars): Frame {
  // Short of the last column, so no line wraps
  const width = columns - 1
  const inner = width - 2
  const rule = dim('─'.repeat(width))

  const input = inputLine(inner, bars)

  return {
    top: ['', ` ${titleLine(inner, bars)}`, rule],
    bottom: [usageRule(width, bars.usage), ` ${fit(statusLine(bars), inner)}`, ` ${input.line}`, ''],
    // Hidden while a question is open: the keys are its own
    cursor: bars.asking ? undefined : { row: 2, column: input.column + 1 },
  }
}

/**
 * The model and its thinking level always; then the workspace, its first folders left out until it fits, or none of it.
 * The provider goes last, before the model's own name is cut.
 */
function titleLine(width: number, bars: Bars): string {
  const full = title(bars.model, bars.thinking)
  for (const root of shortenedRoots(bars.root)) {
    const line = full + dim(` · ${root}`)
    if (widthOf(line) <= width) {
      return line
    }
  }

  if (widthOf(full) <= width) {
    return full
  }

  const withoutProvider = bars.model.slice(bars.model.indexOf('/') + 1)
  return fit(title(withoutProvider, bars.thinking), width)
}

/** `ji · deepseek/deepseek-v4-flash · high` */
function title(model: string, thinking: string): string {
  return `${styleText('bold', 'ji')} ${dim('·')} ${model}${dim(` · ${thinking}`)}`
}

/** `~/a/b/c`, then `…/b/c`, then `…/c`. */
function shortenedRoots(root: string): string[] {
  const folders = root.split('/')
  const shortened = [root]
  for (let start = 1; start < folders.length; start++) {
    shortened.push(`…/${folders.slice(start).join('/')}`)
  }
  return shortened
}

/** A rule with the session's usage at its right end, as much of it as fits; a plain one before any model call. */
function usageRule(width: number, usage: string[]): string {
  for (let shown = usage.length; shown > 0; shown--) {
    const label = ` ${usage.slice(0, shown).join(' · ')} `
    const left = width - widthOf(label) - 1
    if (left >= 8) {
      return dim(`${'─'.repeat(left)}${label}─`)
    }
  }
  return dim('─'.repeat(width))
}

/**
 * The view, if it is the full one; what runs and for how long, what is scrolled past, the mode, what a yes allowed, the
 * steers not yet delivered, the keys that matter now.
 */
function statusLine(bars: Bars): string {
  let details = ''
  if (bars.view === 'full') {
    details = `${styleText('cyan', 'details')} ${hint('Ctrl+O', 'hides', 'cyan')}`
  }

  const mode = bars.auto ? styleText('yellow', bars.mode) : dim(bars.mode)
  // As careless as auto, until switching back to ask takes it back
  const allowed = bars.allowed === '' ? '' : styleText('yellow', bars.allowed)
  const queued = bars.queued === 0 ? '' : styleText('cyan', `${bars.queued} queued`)

  let below = ''
  if (bars.below > 0) {
    below = `${styleText('yellow', `↓ ${bars.below} more lines`)} ${styleText(['yellow', 'bold'], 'PgDn')}`
  }

  return [details, bars.status, below, mode, allowed, queued, hints(keysOf(bars))]
    .filter(part => part !== '')
    .join(dim(' · '))
}

/** The keys that matter now. */
function keysOf(bars: Bars): Hint[] {
  if (!bars.replying) {
    const keys: Hint[] = [
      ['Shift+Tab', 'switches'],
      ['/exit', 'quits'],
    ]
    return bars.view === 'brief' ? [['Ctrl+O', 'details'], ...keys] : keys
  }
  if (bars.asking) {
    // Its keys are its own, listed under it; Ctrl+C still stops the whole reply
    return [['Ctrl+C', 'stops']]
  }
  return [
    ['Enter', 'steers'],
    ['Ctrl+C', 'stops'],
  ]
}

/** The prompt, then the text around the cursor, scrolled sideways to keep the cursor in view. */
function inputLine(width: number, bars: Bars): { line: string; column: number } {
  const prompt = `${styleText(bars.asking ? 'gray' : 'cyan', '›')} `
  const space = width - 2
  if (textOf(bars.editing) === '') {
    return { line: prompt + fit(dim(placeholder(bars)), space), column: 2 }
  }

  // At least the cursor's own cell stays free after the text before it
  const left = tail(bars.editing.before, space - 1)
  const right = fit(bars.editing.after, space - widthOf(left))
  const paint = bars.asking ? dim : (s: string): string => s
  return { line: prompt + paint(left + right), column: 2 + widthOf(left) }
}

function placeholder(bars: Bars): string {
  if (bars.asking) {
    return 'Answer the question above'
  }
  return bars.replying ? 'Steer the reply: it reads this after the step in progress' : 'Ask anything'
}
