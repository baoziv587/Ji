// The coding agent's commands: /think switches the thinking level, /fast the priority tier of OpenAI's models, /compact
// summarizes the conversation so far, /help lists the commands, the keys by when they work, the mode and the tools,
// /exit quits.

import type { HelpSection } from '@ji.dev/tui'
import type { Conversation } from '../agent/conversation.ts'
import type { Command } from './menu.ts'
import { log } from '@clack/prompts'
import { COMPACT_COMMAND } from '@ji.dev/plugin-compaction'
import { formatHelpSections, widthBesideRail } from '@ji.dev/tui'
import { supportsFastMode } from '../agent/fast.ts'
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

export function createCommandMenu({
  conversation,
  tools,
  mode,
  send,
  quit,
  extra = () => [],
}: CommandContext): CommandMenu {
  const levels = conversation.agent.model.thinkingLevels.join('|')

  const menu: CommandMenu = new CommandMenu(() => [
    { name: '/think', arg: `<${levels}>`, hint: 'sets thinking', run: arg => think(conversation, arg) },
    { name: '/fast', arg: '[on|off]', hint: 'answers faster, for more usage', run: arg => fast(conversation, arg) },
    { name: '/compact', hint: 'summarizes the conversation so far', run: () => compact(conversation, send) },
    { name: '/help', hint: 'lists keys, commands and tools', run: () => help(menu, tools, mode()) },
    { name: '/exit', hint: 'quits', run: quit },
    ...extra(),
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

/** on or off as given; without either, the other way round. Only OpenAI's models have the tier. */
function fast(conversation: Conversation, arg: string): void {
  const { model } = conversation.agent
  if (!supportsFastMode(model)) {
    log.info(`Fast mode is for openai and openai-codex models, not ${model.provider}/${model.id}.`)
    return
  }

  let on = !conversation.fast
  if (arg === 'on' || arg === 'off') {
    on = arg === 'on'
  }
  conversation.useFastMode(on)
  log.success(on ? 'Fast: on, at about 2x the usage per token' : 'Fast: off')
}

/**
 * The compaction plugin answers the command inside a reply: everything before the last reply becomes a summary. With
 * nothing said yet there is no reply to end, so nothing is sent.
 */
function compact(conversation: Conversation, send: (message: string) => void): void {
  if (conversation.empty) {
    log.info('Nothing to compact yet.')
    return
  }

  send(COMPACT_COMMAND)
}

function help(menu: CommandMenu, tools: string[], mode: string): void {
  const groups = [...menu.groups()].map(([group, names]): HelpSection => {
    return { title: `${group} (${names.length})`, rows: names.join(', ') }
  })
  const sections: HelpSection[] = [
    { title: 'Commands', rows: menu.hints() },
    ...groups,
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
    { title: 'Mode', rows: mode },
    { title: `Tools (${tools.length})`, rows: tools.join(', ') },
  ]
  log.message(formatHelpSections(sections, widthBesideRail()), { spacing: 0 })
}
