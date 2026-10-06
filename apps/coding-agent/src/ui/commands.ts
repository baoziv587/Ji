// The coding agent's commands: /think switches the thinking level, /help lists the commands, the keys by when they
// work and the tools, /exit quits.

import type { HelpSection } from '@ji.dev/tui'
import type { Conversation } from '../agent/conversation.ts'
import type { Command } from './menu.ts'
import { log } from '@clack/prompts'
import { formatHelpSections, widthBesideRail } from '@ji.dev/tui'
import { CommandMenu } from './menu.ts'

export interface CommandContext {
  conversation: Conversation
  /** Every tool the model can call, by name. */
  tools: string[]
  quit: () => void
  /** The features' commands, after the built-in ones. */
  extra?: Command[]
}

export function createCommandMenu({ conversation, tools, quit, extra = [] }: CommandContext): CommandMenu {
  const levels = conversation.agent.model.thinkingLevels.join('|')

  const menu: CommandMenu = new CommandMenu([
    { name: '/think', arg: `<${levels}>`, hint: 'sets thinking', run: arg => think(conversation, arg) },
    { name: '/help', hint: 'lists keys, commands and tools', run: () => help(menu, tools) },
    { name: '/exit', hint: 'quits', run: quit },
    ...extra,
  ])
  return menu
}

/** The level given; without one, or an unknown one, the level now and the choices. */
function think(conversation: Conversation, arg: string): void {
  const { model, thinking } = conversation.agent
  const level = model.thinkingLevels.find(l => l === arg)
  if (level === undefined) {
    log.info(`Thinking: ${thinking}. Change it with /think <${model.thinkingLevels.join('|')}>.`)
    return
  }

  conversation.think(level)
  log.success(`Thinking: ${conversation.agent.thinking}`)
}

function help(menu: CommandMenu, tools: string[]): void {
  const sections: HelpSection[] = [
    { title: 'Commands', rows: menu.hints() },
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
    { title: `Tools (${tools.length})`, rows: tools.join(', ') },
  ]
  log.message(formatHelpSections(sections, widthBesideRail()), { spacing: 0 })
}
