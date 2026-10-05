// The two bars around the conversation. On top, the model and its settings; at the bottom, the session's usage, the
// status line and the input line with the cursor in it. Both keep a blank row at the terminal's edge and a column on
// each side of their text; only the rules run across.

import type { Editing, Frame, KeyHint, View } from '@ji.dev/tui'
import { styleText } from 'node:util'
import {
  dimText,
  drawRuleWithLabels,
  fitToWidth,
  formatKeyHint,
  formatKeyHints,
  leftTruncatedPaths,
  pickFirstThatFits,
  renderInputLine,
} from '@ji.dev/tui'

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

  const heading = titleLine(inner, bars)
  const rule = dimText('─'.repeat(width))

  const usage = drawRuleWithLabels(width, bars.usage)
  const status = fitToWidth(statusLine(bars), inner)
  const input = renderInputLine(bars.editing, inner, { placeholder: placeholder(bars), muted: bars.asking })

  return {
    top: ['', ` ${heading}`, rule],
    bottom: [usage, ` ${status}`, ` ${input.line}`, ''],
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
  const withRoot = leftTruncatedPaths(bars.root).map(root => full + dimText(` · ${root}`))
  const fitting = pickFirstThatFits(width, [...withRoot, full])
  if (fitting !== undefined) {
    return fitting
  }

  const withoutProvider = bars.model.slice(bars.model.indexOf('/') + 1)
  return fitToWidth(title(withoutProvider, bars.thinking), width)
}

/** `ji · deepseek/deepseek-v4-flash · high` */
function title(model: string, thinking: string): string {
  return `${styleText('bold', 'ji')} ${dimText('·')} ${model}${dimText(` · ${thinking}`)}`
}

/**
 * The view, if it is the full one; what runs and for how long, what is scrolled past, the mode, what a yes allowed, the
 * steers not yet delivered, the keys that matter now.
 */
function statusLine(bars: Bars): string {
  let details = ''
  if (bars.view === 'full') {
    details = `${styleText('cyan', 'details')} ${formatKeyHint('Ctrl+O', 'hides', 'cyan')}`
  }

  const mode = bars.auto ? styleText('yellow', bars.mode) : dimText(bars.mode)
  // As careless as auto, until switching back to ask takes it back
  const allowed = bars.allowed === '' ? '' : styleText('yellow', bars.allowed)
  const queued = bars.queued === 0 ? '' : styleText('cyan', `${bars.queued} queued`)

  let below = ''
  if (bars.below > 0) {
    below = `${styleText('yellow', `↓ ${bars.below} more lines`)} ${styleText(['yellow', 'bold'], 'PgDn')}`
  }

  return [details, bars.status, below, mode, allowed, queued, formatKeyHints(keysOf(bars))]
    .filter(part => part !== '')
    .join(dimText(' · '))
}

/** The keys that matter now. */
function keysOf(bars: Bars): KeyHint[] {
  if (!bars.replying) {
    const keys: KeyHint[] = [
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

function placeholder(bars: Bars): string {
  if (bars.asking) {
    return 'Answer the question above'
  }
  return bars.replying ? 'Steer the reply: it reads this after the step in progress' : 'Ask anything'
}
