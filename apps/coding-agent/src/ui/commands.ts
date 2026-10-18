// The terminal's part in the session's commands (agent/commands.ts, run by the service): /exit quits the terminal and
// leaves the session as it is, and /help lists the terminal's keys before the mode.

import type { HelpSection } from '../agent/commands.ts'
import { log } from '@clack/prompts'
import { formatHelpSections, widthBesideRail } from '@ji.dev/tui'
import { MODE_SECTION } from '../agent/commands.ts'

/** The one command the terminal runs itself. */
export const EXIT_COMMAND = '/exit'

/** The terminal's keys, by when they work. */
const KEYS: HelpSection[] = [
  {
    title: 'While replying',
    rows: [
      ['Enter', 'steers a reply'],
      ['Ctrl+C', 'stops a reply'],
      ['Esc', 'dismisses a question'],
    ],
  },
  {
    title: 'Anytime',
    rows: [
      ['Shift+Tab', 'switches ask/auto'],
      ['Ctrl+O', 'shows details'],
      ['Wheel, PgUp/PgDn', 'scroll'],
    ],
  },
]

/** What /help lists, with the terminal's keys before the mode. */
export function withKeys(sections: readonly HelpSection[]): HelpSection[] {
  const at = sections.findIndex(s => s.title === MODE_SECTION)
  const before = at === -1 ? sections.length : at
  return [...sections.slice(0, before), ...KEYS, ...sections.slice(before)]
}

export function showHelp(sections: readonly HelpSection[]): void {
  log.message(formatHelpSections(withKeys(sections), widthBesideRail()), { spacing: 0 })
}
