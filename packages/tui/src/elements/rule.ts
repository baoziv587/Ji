// A dim rule across the width, with labels at its end.

import type { Element } from './element.ts'
import { stripVTControlCharacters } from 'node:util'
import { dimText, displayWidth } from '../text.ts'

/** The narrowest a rule's lines run before its labels, for it to still read as a rule. */
const MIN_RULE = 8

/**
 * As many of `labels` at its right end as fit, from the first; none, a plain rule. A label is dim like the rule, unless
 * it brings a color of its own: a warning is not dimmed.
 */
export function createRuleElement(labels: string[]): Element {
  return {
    render: width => ({ rows: [drawRule(width, labels)] }),
  }
}

function drawRule(width: number, labels: string[]): string {
  for (let shown = labels.length; shown > 0; shown--) {
    const kept = labels.slice(0, shown)
    const left = width - displayWidth(` ${kept.join(' · ')} `) - 1
    if (left < MIN_RULE) {
      continue
    }

    const painted = kept.map(paintLabel).join(dimText(' · '))
    return `${dimText(`${'─'.repeat(left)} `)}${painted}${dimText(' ─')}`
  }
  return dimText('─'.repeat(width))
}

function paintLabel(label: string): string {
  return stripVTControlCharacters(label) === label ? dimText(label) : label
}
