// The coding agent's commands, run in a session of the service (server/service.ts) for whichever client it has: the
// terminal lists them in its menu (ui/menu.ts), the desktop app in its own. /model switches the model, /think the thinking level, /fast the priority tier of OpenAI's models, /compact
// summarizes the conversation so far, /help lists the commands, the keys by when they work, the mode and the tools,
// /exit quits; the features add theirs after them. What a command has to say goes through `say`: the log in the
// terminal, events for the service's client.

import type { Agent } from '@ji.dev/llm'
import type { Conversation } from './conversation.ts'
import { COMPACT_COMMAND } from '@ji.dev/plugin-compaction'
import { errorMessage } from '@ji.dev/utils'
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

/** The title of /help's part on the mode: a client's keys go before it. */
export const MODE_SECTION = 'Mode'

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
  /** Shows what /help lists: a client adds its keys before the mode. */
  help: (sections: HelpSection[]) => void
  /** The features' commands, after the built-in ones; read every time, as they can change. */
  extra?: () => Command[]
  /** The agent on another model, 'provider/id' (agent.ts' startOn); without it, no /model. */
  startOn?: (spec: string) => Agent
}

/** The commands, built-in ones first; read every time, as the features' can change. */
export function createCommands(options: CommandOptions): () => Command[] {
  const { conversation, tools, mode, send, quit, say, help, extra = () => [], startOn } = options
  const levels = (): string[] => [...conversation.agent.model.thinkingLevels]
  const switching: Command[] =
    startOn === undefined
      ? []
      : [
          {
            name: '/model',
            arg: '<provider/id>',
            hint: 'switches the model',
            run: arg => switchModel(conversation, arg.trim(), startOn, say),
          },
        ]

  const commands = (): Command[] => [
    ...switching,
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
    { name: '/help', hint: 'lists keys, commands and tools', run: () => help(helpOf(commands(), tools, mode())) },
    { name: '/exit', hint: 'quits', run: quit },
    ...extra(),
  ]
  return commands
}

/** The command a line names, with what follows its name; undefined for a line that is no command. */
function commandOf(
  commands: readonly Command[],
  line: string,
): { command?: Command; name: string; arg: string } | undefined {
  if (!line.startsWith('/')) {
    return undefined
  }

  const [name, ...rest] = line.trim().split(/\s+/)
  return { command: commands.find(c => c.name === name), name, arg: rest.join(' ') }
}

/**
 * Runs the command the line names: 'send' when the line is no command, or names one only the model knows (a skill's),
 * so it goes as a message. A name no command has is warned of, and counts as run.
 */
export function runCommand(commands: readonly Command[], line: string, warn: (text: string) => void): 'ran' | 'send' {
  const named = commandOf(commands, line)
  if (named === undefined) {
    return 'send'
  }

  const { command, name, arg } = named
  if (command === undefined) {
    warn(`No such command: ${name}. /help lists them.`)
    return 'ran'
  }
  if (command.run === undefined) {
    return 'send'
  }

  command.run(arg)
  return 'ran'
}

/** The model given; without one, the model now. An unknown one is told with the closest match. */
function switchModel(conversation: Conversation, spec: string, startOn: (spec: string) => Agent, say: Say): void {
  const { model } = conversation.agent
  if (spec === '') {
    say.info(`Model: ${model.provider}/${model.id}. Change it with /model <provider/id>.`)
    return
  }

  try {
    conversation.use(startOn(spec))
  } catch (error) {
    say.error(errorMessage(error))
    return
  }

  const { model: now, thinking } = conversation.agent
  say.success(`Model: ${now.provider}/${now.id}, thinking ${thinking}`)
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

/** The commands without a group with their hints, the others by group; then the mode and the tools. */
function helpOf(commands: readonly Command[], tools: string[], mode: string): HelpSection[] {
  const groups = new Map<string, string[]>()
  for (const { name, group } of commands) {
    if (group !== undefined) {
      groups.set(group, [...(groups.get(group) ?? []), name])
    }
  }

  return [
    { title: 'Commands', rows: commands.filter(c => c.group === undefined).map(hintOf) },
    ...[...groups].map(([group, names]) => ({ title: `${group} (${names.length})`, rows: names.join(', ') })),
    { title: MODE_SECTION, rows: mode },
    { title: `Tools (${tools.length})`, rows: tools.join(', ') },
  ]
}

/** The name alone in the key column, so a long argument hint does not push every column out; the hint comes after it. */
export function hintOf({ name, arg, hint }: Pick<Command, 'name' | 'arg' | 'hint'>): [string, string] {
  return [name, arg === undefined ? hint : `${arg}  ${hint}`]
}
