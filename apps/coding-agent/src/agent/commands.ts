// The coding agent's commands, the same wherever it runs: in the terminal (ui/commands.ts) and in a session of the
// service (server/service.ts). /think switches the thinking level, /fast the priority tier of OpenAI's models, /compact
// summarizes the conversation so far, /help lists the commands, the keys by when they work, the mode and the tools,
// /exit quits; the features add theirs after them. What a command has to say goes through `say`: the log in the
// terminal, events for the service's client.

import type { Conversation } from './conversation.ts'
import { COMPACT_COMMAND } from '@ji.dev/plugin-compaction'
import { supportsFastMode } from './fast.ts'

export interface Command {
  name: string
  /** What it takes after its name, as the menu shows it; without one, the menu runs it at once. */
  arg?: string
  hint: string
  /** What it takes, when it is one of a few: a menu offers them. Read every time, as they can change. */
  choices?: () => string[]
  /** What it does. Without one, the line goes to the model as typed: a plugin knows what it means. */
  run?: (arg: string) => void
  /** Where /help lists it, by name only among the others of its group; without one, under Commands with its hint. */
  group?: string
}

/** What a command has to say, by how it went: @clack/prompts' log is one. */
export interface Say {
  info: (text: string) => void
  success: (text: string) => void
  warn: (text: string) => void
  error: (text: string) => void
}

/** A part of /help: rows of a key and what it does, or a line of text. */
export interface HelpSection {
  title: string
  rows: [key: string, action: string][] | string
}

export interface CommandOptions {
  conversation: Conversation
  /** Every tool the model can call, by name. */
  tools: string[]
  /** The mode now, in full: the status line shows only its name. */
  mode: () => string
  /** Sends a message as if typed, and shows the reply. */
  send: (message: string) => void
  quit: () => void
  say: Say
  /** Shows what /help lists. */
  help: (sections: HelpSection[]) => void
  /** The keys, by when they work, for /help: they are the screen's own. */
  keys?: HelpSection[]
  /** The features' commands, after the built-in ones; read every time, as they can change. */
  extra?: () => Command[]
}

/** The commands, built-in ones first; read every time, as the features' can change. */
export function createCommands(options: CommandOptions): () => Command[] {
  const { conversation, tools, mode, send, quit, say, help, keys = [], extra = () => [] } = options
  const levels = (): string[] => [...conversation.agent.model.thinkingLevels]

  const commands = (): Command[] => [
    {
      name: '/think',
      arg: `<${levels().join('|')}>`,
      hint: 'sets thinking',
      choices: levels,
      run: arg => think(conversation, arg, say),
    },
    {
      name: '/fast',
      arg: '[on|off]',
      hint: 'answers faster, for more usage',
      choices: () => ['on', 'off'],
      run: arg => fast(conversation, arg, say),
    },
    { name: '/compact', hint: 'summarizes the conversation so far', run: () => compact(conversation, send, say) },
    { name: '/help', hint: 'lists keys, commands and tools', run: () => help(helpOf(commands(), keys, tools, mode())) },
    { name: '/exit', hint: 'quits', run: quit },
    ...extra(),
  ]
  return commands
}

/** The command a line names, with what follows its name; undefined for a line that is no command. */
export function commandOf(
  commands: readonly Command[],
  line: string,
): { command?: Command; name: string; arg: string } | undefined {
  if (!line.startsWith('/')) {
    return undefined
  }

  const [name, ...rest] = line.trim().split(/\s+/)
  return { command: commands.find(c => c.name === name), name, arg: rest.join(' ') }
}

/** The level given; without one, or an unknown one, the level now and the choices. */
function think(conversation: Conversation, arg: string, say: Say): void {
  const { model, thinking } = conversation.agent
  const level = model.thinkingLevels.find(l => l === arg)
  if (level === undefined) {
    say.info(`Thinking: ${thinking}. Change it with /think <${model.thinkingLevels.join('|')}>.`)
    return
  }

  conversation.think(level)
  say.success(`Thinking: ${conversation.agent.thinking}`)
}

/** on or off as given; without either, the other way round. Only OpenAI's models have the tier. */
function fast(conversation: Conversation, arg: string, say: Say): void {
  const { model } = conversation.agent
  if (!supportsFastMode(model)) {
    say.info(`Fast mode is for openai and openai-codex models, not ${model.provider}/${model.id}.`)
    return
  }

  let on = !conversation.fast
  if (arg === 'on' || arg === 'off') {
    on = arg === 'on'
  }

  conversation.useFastMode(on)
  say.success(on ? 'Fast: on, at about 2x the usage per token' : 'Fast: off')
}

/**
 * The compaction plugin answers the command inside a reply: everything before the last reply becomes a summary. With
 * nothing said yet there is no reply to end, so nothing is sent.
 */
function compact(conversation: Conversation, send: (message: string) => void, say: Say): void {
  if (conversation.empty) {
    say.info('Nothing to compact yet.')
    return
  }

  send(COMPACT_COMMAND)
}

/** The commands without a group with their hints, the others by group; then the keys, the mode and the tools. */
function helpOf(commands: readonly Command[], keys: HelpSection[], tools: string[], mode: string): HelpSection[] {
  const groups = new Map<string, string[]>()
  for (const { name, group } of commands) {
    if (group !== undefined) {
      groups.set(group, [...(groups.get(group) ?? []), name])
    }
  }

  return [
    { title: 'Commands', rows: commands.filter(c => c.group === undefined).map(hintOf) },
    ...[...groups].map(([group, names]) => ({ title: `${group} (${names.length})`, rows: names.join(', ') })),
    ...keys,
    { title: 'Mode', rows: mode },
    { title: `Tools (${tools.length})`, rows: tools.join(', ') },
  ]
}

/** The name alone in the key column, so a long argument hint does not push every column out; the hint comes after it. */
export function hintOf({ name, arg, hint }: Command): [string, string] {
  return [name, arg === undefined ? hint : `${arg}  ${hint}`]
}
