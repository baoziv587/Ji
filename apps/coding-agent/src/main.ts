// A coding agent to chat with in the terminal: DEEPSEEK_API_KEY=sk-... pnpm coding-agent
//
//   It fills the terminal: a bar on top (model, thinking, workspace; the workspace gives way first on a narrow one) and
//   one at the bottom (the status, and the line you type in) stay put, and only the conversation between them scrolls,
//   with the wheel or PgUp/PgDn. On exit the conversation is printed to the terminal, where it stays
//   Enter sends; replies stream in, with one line per tool call as it finishes. Thinking shows as one line with its
//   length; Ctrl+O shows it in full, and every call's arguments and result, and back
//   The line above the status adds up the session: tokens in and out, cache hits, speed, cost. On exit the session's
//   id and its usage in full are printed below the conversation
//   Enter during a reply steers it: the message reaches the model after the step in progress, and shows above then
//   Ctrl+C during a reply stops only that reply; Ctrl+C on an empty line or /exit quits
//   /help lists the keys, the commands and the tools; a / typed on an empty line opens a menu of the commands, and
//   ↑↓ and Enter run one, Tab completes it
//   DEEPSEEK_MODEL=deepseek-v4-pro switches the model (default deepseek-v4-flash)
//   DEEPSEEK_THINKING=off turns thinking off (default high); /think <level> switches it mid-chat, thinking shows in gray
//   The model can read and edit files: every read, and every change shown as a diff, waits for a yes
//   It can run commands with bash and search with grep, both in the directory the command was run from; every command
//   waits for a yes, in either mode, since what it touches is not known
//   Shift+Tab switches to auto-approve and back; auto-approve covers only the directory the command was run from, and
//   a call reaching outside it is still asked about, with No under the cursor
//   A yes can say not to ask again: about any command, or about reads in the folder of a file outside. What it allows
//   shows in the status; switching back to ask takes it back
//   Code shows in color: a reply's code blocks, the command or diff of a question, and a file read in Ctrl+O's view
//   The model can ask questions of its own, with options it writes; Esc dismisses any question
//
// Everything comes from @ji.dev/llm: the model, its thinking levels and the events need nothing from pi-ai.
//
// The code, a folder a part. This file puts them together, holds the keys, and starts and quits.
//
//   agent/    the model, its plugins, and the conversation: sending, steering, going back after a reply that stopped
//   plugins/  the coding agent's own: two small tools, and what waits for a yes
//   ui/       the terminal: the screen and its bars, a reply and its Markdown, the questions, and the painting they
//             all share
//
// agent/ and plugins/ know nothing of the terminal.

import type { Agent, Run } from '@ji.dev/llm'
import type { Editing, Element, HelpSection, KeyHint, Keypress } from '@ji.dev/tui'
import type { Bars, Menu } from './ui/bars.ts'
import process from 'node:process'
import { cancel, log, outro } from '@clack/prompts'
import { UnknownModelError, UnsupportedThinkingError } from '@ji.dev/llm'
import { choices } from '@ji.dev/plugin-choices'
import {
  abbreviateHomePath,
  applyKey,
  dimText,
  editingText,
  EMPTY_EDITING,
  formatHelpSections,
  formatKeyHint,
  formatKeypress,
  Screen,
  Status,
  widthBesideRail,
} from '@ji.dev/tui'
import { createPlugins, startAgent, toolNamesOf } from './agent/agent.ts'
import { Conversation } from './agent/conversation.ts'
import { Permissions } from './plugins/permissions.ts'
import { Answering } from './ui/answering.ts'
import { viewOf } from './ui/bars.ts'
import { render } from './ui/reply/render.ts'
import { Meter } from './ui/usage.ts'

// The parts

/** Where the command was run from: pnpm --filter starts the script in the package's own directory. */
const ROOT = process.env.INIT_CWD ?? process.cwd()

/** The root as the top bar shows it. */
const WORKSPACE = abbreviateHomePath(ROOT)

const plugins = createPlugins(ROOT)

/** What waits for a yes; Shift+Tab switches its mode, at the prompt or at a question. */
const permissions = new Permissions(ROOT, plugins.files, plugins.shell)

/** The bars around the conversation, built by buildView; stdout is the conversation between them. */
const screen = new Screen(buildView)

/** What the session has spent, on the line above the status. */
const meter = new Meter()

const status = new Status(() => screen.draw())

const answering = new Answering(screen, status, permissions)

/**
 * The model asks with ask_user; permissions say which calls wait for a yes (RFC-0007 §5). None of them knows about the
 * terminal: `answer` puts every question to the person.
 */
const asking = choices({ answer: answering.answer, approve: permissions.approve })

const conversation = new Conversation(startAgentOrQuit())

/** Where a reply shows: the conversation's part of the screen. */
const stage = {
  screen,
  status,
  meter,
  answered: () => answering.answered(),
  fileTools: new Set(plugins.files.tools?.map(t => t.name)),
}

const levels = conversation.agent.model.thinkingLevels.join('|')

const TOOLS = toolNamesOf(plugins, asking)

const { promise: quitting, resolve: quit } = Promise.withResolvers<void>()

/** A command typed after a `/`: the menu lists it, /help too, and Enter runs it. */
interface Command {
  name: string
  /** What it takes after its name, as the menu shows it; without one, the menu runs it at once. */
  arg?: string
  hint: string
  run: (arg: string) => void
}

const COMMANDS: Command[] = [
  { name: '/think', arg: `<${levels}>`, hint: 'sets thinking', run: think },
  { name: '/help', hint: 'lists keys, commands and tools', run: help },
  { name: '/exit', hint: 'quits', run: () => quit() },
]

/** What /help lists: the commands, the keys by when they work, and the tools. */
const HELP: HelpSection[] = [
  {
    title: 'Commands',
    rows: COMMANDS.map(hintOf),
  },
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
  { title: `Tools (${TOOLS.length})`, rows: TOOLS.join(', ') },
]

const MISSING_KEY =
  'DEEPSEEK_API_KEY is not set. Quit with /exit, run `export DEEPSEEK_API_KEY=sk-...`, and start again.'

// The state

/** The input line. */
let editing: Editing = EMPTY_EDITING

/** The command chosen in the menu, by its place among the ones that match: back to the first as the text changes. */
let selected = 0

/** The reply in progress, settled once it has written its last line. */
let replying: Promise<void> = Promise.resolve()

// The keys

/**
 * The mode, the view and Ctrl+C work everywhere, as scrolling does in the screen; while a question is open, the other
 * keys are its own. Pastes come between markers, so a pasted line break does not send. The screen draws after each.
 */
function onKey(char: string | undefined, raw: Keypress | undefined): void {
  const key = { ...raw, char }
  const name = formatKeypress(key)
  switch (name) {
    case 'shift+tab':
      answering.switchMode()
      return
    case 'ctrl+o':
      screen.toggle()
      return
    case 'ctrl+c':
      interrupt()
      return
  }
  if (answering.open) {
    return
  }

  const matching = matchingCommands()
  if (matching !== undefined && onMenuKey(name, matching)) {
    return
  }
  if (name === 'return' && !editing.pasting) {
    submit()
    return
  }

  const typed = editingText(editing)
  editing = applyKey(editing, key)
  if (editingText(editing) !== typed) {
    selected = 0
  }
}

/** The menu's keys: ↑↓ choose, Tab completes, Enter runs or completes one that takes something, Esc closes. */
function onMenuKey(name: string, matching: Command[]): boolean {
  const command = matching[selected]
  switch (name) {
    case 'up':
      selected = (selected + matching.length - 1) % matching.length
      return true
    case 'down':
      selected = (selected + 1) % matching.length
      return true
    case 'tab':
      complete(command)
      return true
    case 'escape':
      editing = EMPTY_EDITING
      return true
    case 'return':
      if (editing.pasting) {
        return false
      }

      complete(command)
      if (command.arg === undefined) {
        submit()
      }
      return true
  }

  return false
}

/** The command's name in the input, with a space after it when it takes something, for what comes next. */
function complete(command: Command): void {
  editing = { ...EMPTY_EDITING, before: command.arg === undefined ? command.name : `${command.name} ` }
  selected = 0
}

/** The commands that start with what is typed, while a command is being typed: a `/` and no space yet. */
function matchingCommands(): Command[] | undefined {
  const typed = editingText(editing)
  if (!/^\/\S*$/.test(typed)) {
    return undefined
  }
  const matching = COMMANDS.filter(command => command.name.startsWith(typed))
  return matching.length === 0 ? undefined : matching
}

/** `/think <level>` and what it does, for the menu and /help. */
function hintOf({ name, arg, hint }: Command): KeyHint {
  return [arg === undefined ? name : `${name} ${arg}`, hint]
}

/** Enter: a command, a new reply, or a steer for the one in progress. */
function submit(): void {
  const message = editingText(editing).trim()
  if (message !== '' && !message.startsWith('/') && !conversation.agent.model.hasEnvKey) {
    // The message stays in the input, to send once the key is set
    log.warn(MISSING_KEY)
    return
  }

  editing = EMPTY_EDITING
  screen.follow()
  if (message === '') {
    return
  }
  if (message.startsWith('/')) {
    const [name, ...rest] = message.split(/\s+/)
    const command = COMMANDS.find(c => c.name === name)

    if (command === undefined) {
      log.warn(`No such command: ${name}. /help lists them.`)
      return
    }
    command.run(rest.join(' '))
    return
  }

  // Undefined for a steer: it shows once it reaches the model, and is counted as queued until then
  const run = conversation.send(message)
  if (run !== undefined) {
    replying = converse(run)
  }
}

function help(): void {
  log.message(formatHelpSections(HELP, widthBesideRail()), { spacing: 0 })
}

function think(arg: string): void {
  const level = conversation.agent.model.thinkingLevels.find(l => l === arg)
  if (level === undefined) {
    log.info(`Thinking: ${conversation.agent.thinking}. Change it with /think <${levels}>.`)
    return
  }

  conversation.think(level)
  log.success(`Thinking: ${conversation.agent.thinking}`)
}

/** Shows a reply to its end. One that does not finish puts what it was sent back in the input, ahead of what is typed. */
async function converse(run: Run): Promise<void> {
  const changed = new Set<string>()
  const unfinished = await conversation.follow(run, r => render(r, stage, changed))

  if (unfinished !== undefined) {
    const { sent, stopped, error } = unfinished
    editing = { ...EMPTY_EDITING, before: [...sent, editingText(editing)].filter(t => t !== '').join(' ') }

    const back = sent.length === 1 ? 'Your message is back in the input.' : 'Your messages are back in the input.'
    // The history goes back, the files do not: a resend should not take them for untouched
    const stays = changed.size === 1 ? 'stays' : 'stay'
    const kept = changed.size === 0 ? '' : `${[...changed].join(', ')} ${stays} changed. `
    if (stopped) {
      log.warn(`Stopped. ${kept}${back} Edit it or clear it.`)
    } else {
      log.error(`${error instanceof Error ? error.message : String(error)}\n${kept}${back} Press Enter to retry.`)
    }
  }

  screen.draw()
}

/** Ctrl+C: stops the reply; with none, clears the input; with an empty input, quits. */
function interrupt(): void {
  if (conversation.replying) {
    conversation.stop()
  } else if (editingText(editing) !== '') {
    editing = EMPTY_EDITING
  } else {
    quit()
  }
}

// The screen

function buildView(): Element {
  const { model, thinking } = conversation.agent
  const bars: Bars = {
    model: `${model.provider}/${model.id}`,
    thinking,
    root: WORKSPACE,
    editing,
    replying: conversation.replying,
    asking: answering.open,
    queued: conversation.queued,
    usage: meter.parts(),
    status: status.describe(),
    view: screen.view,
    below: screen.below,
    mode: permissions.describeMode(),
    auto: permissions.mode === 'auto',
    allowed: permissions.describeAllowed(),
    menu: menuOf(),
  }
  return viewOf(bars, screen.content)
}

/** The matching commands as the menu shows them, the chosen one marked; none while no command is typed. */
function menuOf(): Menu | undefined {
  const matching = matchingCommands()
  if (matching === undefined) {
    return undefined
  }

  return { items: matching.map(hintOf), selected }
}

// Starting and quitting

/** A typo in the model or the level stops the coding agent before the first prompt, with the choices listed. */
function startAgentOrQuit(): Agent {
  try {
    return startAgent(ROOT, plugins, asking)
  } catch (error) {
    if (error instanceof UnknownModelError || error instanceof UnsupportedThinkingError) {
      cancel(error.message)
      process.exit(1)
    }
    throw error
  }
}

if (!Screen.isSupported()) {
  cancel('The coding agent draws a bar at the bottom of a terminal: run it in one.')
  process.exit(1)
}

// Ctrl+C reaches the keypress listener as a key; the SIGINT comes from a question's prompt, which passes it on
process.on('SIGINT', () => {
  if (!conversation.replying) {
    process.exit(130)
  }
  conversation.stop()
})

// Added before any question's listener, so the question redraws after a mode switch and shows the new mode
screen.keys.on('keypress', onKey)

screen.start()

const toolCount = TOOLS.length === 1 ? '1 tool' : `${TOOLS.length} tools`
const welcome = `${dimText(`${toolCount} ·`)} ${formatKeyHint('/help', 'lists keys, commands and tools')}`
log.message(welcome, { spacing: 0 })

// The key is only needed to send, so its absence is pointed out without blocking anything else
if (!conversation.agent.model.hasEnvKey) {
  log.warn(MISSING_KEY)
}

await quitting
conversation.stop()
await replying

await screen.settled()
screen.stop()
log.message(`Session: ${conversation.id}\n${meter.summary()}`)
outro('Bye')
