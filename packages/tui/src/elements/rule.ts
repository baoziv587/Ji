// A dim rule across the width, with labels at its end.

import type { Element } from './element.ts'
import { dimText, displayWidth } from '../text.ts'

/** The narrowest a rule's lines run before its labels, for it to still read as a rule. */
const MIN_RULE = 8

/** As many of `labels` at its right end as fit, from the first; none, a plain rule. */
export function createRuleElement(labels: string[]): Element {
  return {
    render: width => ({ rows: [drawRule(width, labels)] }),
  }
}

function drawRule(width: number, labels: string[]): string {
  for (let shown = labels.length; shown > 0; shown--) {
    const label = ` ${labels.slice(0, shown).join(' · ')} `
    const left = width - displayWidth(label) - 1
    if (left >= MIN_RULE) {
      return dimText(`${'─'.repeat(left)}${label}─`)
    }
  }
  return dimText('─'.repeat(width))
}
