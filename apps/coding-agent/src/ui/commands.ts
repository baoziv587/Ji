// The coding agent's commands in the terminal (agent/commands.ts): what they say goes to the log, /help with the
// terminal's keys, and the menu of them opens as a `/` is typed.

import type { Command } from '../agent/commands.ts'
import type { Conversation } from '../agent/conversation.ts'
import { log } from '@clack/prompts'
import { formatHelpSections, widthBesideRail } from '@ji.dev/tui'
import { createCommands } from '../agent/commands.ts'
import { CommandMenu } from './menu.ts'

export interface CommandContext {
  conversation: Conversation
  /** Every tool the model can call, by name. */
  tools: string[]
  /** The mode now, in full: the status line shows only its name. */
  mode: () => string
  /** Sends a message as if typed, and shows the reply. */
  send: (message: string) => void
  quit: () => void
  /** The features' commands, after the built-in ones; read every time, as they can change. */
  extra?: () => Command[]
}

export function createCommandMenu(context: CommandContext): CommandMenu {
  return new CommandMenu(
    createCommands({
      ...context,
      say: log,
      help: sections => log.message(formatHelpSections(sections, widthBesideRail()), { spacing: 0 }),
      keys: [
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
      ],
    }),
  )
}
