// The screen: the conversation between two bars. On top, the model and its settings; at the bottom, the session's
// usage, the status line, the commands menu while a `/` is typed, and the input line with the cursor in it. Both keep
// a blank row at the terminal's edge and a column on each side of their text; only the rules run across.
//
// The menu takes a few rows at most and scrolls inside them, so the conversation keeps its room however many commands
// match; the status line says which of them is chosen, so what is out of view is known to be there.

import type { Editing, Element, KeyHint, View } from '@ji.dev/tui'
import { styleText } from 'node:util'
import {
  createFirstThatFitsElement,
  createInputElement,
  createMenuElement,
  createRuleElement,
  createTextElement,
  dimText,
  formatKeyHint,
  formatKeyHints,
  leftTruncatedPaths,
  padElement,
  paintKey,
  stackVertically,
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
  /** `ask` or `auto`: what each asks about is in /help, so the status line keeps its room. */
  mode: string
  /** The less careful mode, so it stands out in the warning color. */
  auto: boolean
  /** What a yes allowed; empty while nothing is. */
  allowed: string
  /** The commands that match what is typed after a `/`, one chosen; undefined while none is typed. */
  menu?: Menu
}

export interface Menu {
  items: KeyHint[]
  selected: number
}

/** The menu's rows at most: about as many as can be taken in at a glance, and never most of the screen. */
export const MENU_ROWS = 8

/** The bars around `content`, which takes the rows they leave. */
export function viewOf(bars: Bars, content: Element): Element {
  return stackVertically([
    createTextElement(''),
    inset(createFirstThatFitsElement(titleVersions(bars))),
    createRuleElement([]),
    content,
    createRuleElement(bars.usage),
    inset(createTextElement(statusLine(bars))),
    bars.menu && inset(capped(createMenuElement(bars.menu.items, bars.menu.selected), MENU_ROWS)),
    // Muted while a question is open, the cursor hidden: the keys are its own
    inset(createInputElement(bars.editing, { placeholder: placeholder(bars), muted: bars.asking })),
    createTextElement(''),
  ])
}

/** A bar's text, a column in from each side. */
function inset(element: Element): Element {
  return padElement(element, { left: 1, right: 1 })
}

/** No taller than `rows`, whatever room there is: the element keeps its chosen row in view inside them. */
function capped(element: Element, rows: number): Element {
  return { render: (width, height) => element.render(width, Math.min(rows, height ?? rows)) }
}

/**
 * The model and its thinking level always; then the workspace, its first folders left out until it fits, or none of it.
 * The provider goes last, before the model's own name is cut.
 */
function titleVersions(bars: Bars): string[] {
  const full = title(bars.model, bars.thinking)
  const withRoot = leftTruncatedPaths(bars.root).map(root => full + dimText(` · ${root}`))
  const withoutProvider = bars.model.slice(bars.model.indexOf('/') + 1)
  return [...withRoot, full, title(withoutProvider, bars.thinking)]
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
  // Which of the matching commands is chosen: the ones out of view are known to be there, and typing more narrows them
  const chosen = bars.menu === undefined ? '' : dimText(`${bars.menu.selected + 1} of ${bars.menu.items.length}`)

  let below = ''
  if (bars.below > 0) {
    below = `${styleText('yellow', `↓ ${bars.below} more lines`)} ${paintKey('PgDn')}`
  }

  return [details, bars.status, below, mode, allowed, queued, chosen, formatKeyHints(keysOf(bars))]
    .filter(part => part !== '')
    .join(dimText(' · '))
}

/** The keys that matter now. */
function keysOf(bars: Bars): KeyHint[] {
  if (bars.menu !== undefined) {
    return [
      ['↑↓', 'choose'],
      ['Tab', 'completes'],
      ['Enter', 'runs'],
      ['Esc', 'closes'],
    ]
  }
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
