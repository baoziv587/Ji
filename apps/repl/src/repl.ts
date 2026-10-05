// A chat REPL: DEEPSEEK_API_KEY=sk-... pnpm repl
//
//   It fills the terminal: a bar on top (model, thinking, workspace) and one at the bottom (the status, and the line
//   you type in) stay put, and only the conversation between them scrolls, with the wheel or PgUp/PgDn. On exit the
//   conversation is printed to the terminal, where it stays
//   Enter sends; replies stream in, with one line per tool call as it finishes. Thinking shows as one line with its
//   length; Ctrl+O shows it in full, and every call's arguments and result, and back
//   The line above the status adds up the session: tokens in and out, cache hits, speed, cost
//   Enter during a reply steers it: the message reaches the model after the step in progress, and shows above then
//   Ctrl+C during a reply stops only that reply; Ctrl+C on an empty line or /exit quits
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
//   plugins/  the REPL's own: two small tools, and what waits for a yes
//   ui/       the terminal: the screen and its bars, a reply, the questions, and the painting they all share
//
// agent/ and plugins/ know nothing of the terminal.

import type { Agent, Run } from '@ji.dev/llm'
import type { Editing, Keypress } from './ui/screen/editing.ts'
import type { Frame } from './ui/screen/screen.ts'
import process from 'node:process'
import { emitKeypressEvents } from 'node:readline'
import { cancel, log, outro } from '@clack/prompts'
import { UnknownModelError, UnsupportedThinkingError } from '@ji.dev/llm'
import { choices } from '@ji.dev/plugin-choices'
import { createPlugins, startAgent, toolNamesOf } from './agent/agent.ts'
import { Conversation } from './agent/conversation.ts'
import { Permissions } from './plugins/permissions.ts'
import { dim, hints } from './ui/paint/text.ts'
import { Answering } from './ui/questions/answering.ts'
import { render } from './ui/reply/render.ts'
import { frameOf } from './ui/screen/bars.ts'
import { edit, EMPTY, textOf } from './ui/screen/editing.ts'
import { Screen } from './ui/screen/screen.ts'
import { Status } from './ui/screen/status.ts'
import { Meter } from './ui/screen/usage.ts'

// The parts

/** Where the command was run from: pnpm --filter starts the script in the package's own directory. */
const ROOT = process.env.INIT_CWD ?? process.cwd()

const plugins = createPlugins(ROOT)

/** What waits for a yes; Shift+Tab switches its mode, at the prompt or at a question. */
const permissions = new Permissions(ROOT, plugins.files, plugins.shell)

/** The bars around the conversation, drawn by drawFrame; stdout is the conversation between them. */
const screen = new Screen(drawFrame)

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

const MISSING_KEY =
  'DEEPSEEK_API_KEY is not set. Quit with /exit, run `export DEEPSEEK_API_KEY=sk-...`, and start again.'

// The state

/** The input line. */
let editing: Editing = EMPTY

/** The reply in progress, settled once it has written its last line. */
let replying: Promise<void> = Promise.resolve()

const { promise: quitting, resolve: quit } = Promise.withResolvers<void>()

// The keys

/**
 * Scrolling, the mode, the view and Ctrl+C work everywhere; while a question is open, the other keys are its own.
 * Pastes come between markers, so a pasted line break does not send.
 */
function onKey(char: string | undefined, key: (Keypress & { shift?: boolean }) | undefined): void {
  if (key?.name === 'pageup' || key?.name === 'pagedown') {
    screen.page(key.name === 'pageup' ? -1 : 1)
    return
  }
  if (key?.name === 'tab' && key.shift === true) {
    answering.switchMode()
    return
  }
  if (key?.name === 'o' && key.ctrl === true) {
    screen.toggle()
    return
  }
  if (key?.name === 'c' && key.ctrl === true) {
    interrupt()
    return
  }
  if (answering.open) {
    return
  }
  if (key?.name === 'return' && !editing.pasting) {
    submit()
    return
  }

  editing = edit(editing, { ...key, char })
  screen.draw()
}

/** Enter: a command, a new reply, or a steer for the one in progress. */
function submit(): void {
  const message = textOf(editing).trim()
  if (message !== '' && !message.startsWith('/') && !conversation.agent.model.hasEnvKey) {
    // The message stays in the input, to send once the key is set
    log.warn(MISSING_KEY)
    return
  }

  editing = EMPTY
  screen.follow()
  if (message === '') {
    return
  }
  if (message === '/exit') {
    quit()
    return
  }
  if (message === '/think' || message.startsWith('/think ')) {
    think(message.slice('/think'.length).trim())
    return
  }

  const run = conversation.send(message)
  if (run === undefined) {
    // A steer: it shows once it reaches the model, and is counted as queued until then
    screen.draw()
    return
  }
  replying = converse(run)
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
    editing = { ...EMPTY, before: [...sent, textOf(editing)].filter(t => t !== '').join(' ') }

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
  } else if (textOf(editing) !== '') {
    editing = EMPTY
    screen.draw()
  } else {
    quit()
  }
}

// The bars

function drawFrame(columns: number): Frame {
  const { model, thinking } = conversation.agent
  return frameOf(columns, {
    model: `${model.provider}/${model.id}`,
    thinking,
    root: ROOT,
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
  })
}

// Starting and quitting

/** A typo in the model or the level stops the REPL before the first prompt, with the choices listed. */
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

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  cancel('The REPL draws a bar at the bottom of a terminal: run it in one.')
  process.exit(1)
}

// Whatever ends the process, the terminal is given back
process.on('exit', () => screen.stop())

// Ctrl+C reaches the keypress listener as a key; the SIGINT comes from a question's prompt, which passes it on
process.on('SIGINT', () => {
  if (!conversation.replying) {
    process.exit(130)
  }
  conversation.stop()
})

// Added before any question's listener, so the question redraws after a mode switch and shows the new mode
emitKeypressEvents(screen.keys)
screen.keys.on('keypress', onKey)

screen.start()

const help = hints([
  [`/think <${levels}>`, 'sets thinking'],
  ['Enter', 'steers a reply'],
  ['Shift+Tab', 'switches ask/auto'],
  ['Esc', 'dismisses a question'],
  ['Ctrl+C', 'stops a reply'],
  ['Ctrl+O', 'shows details'],
  ['Wheel, PgUp/PgDn', 'scroll'],
  ['/exit', 'quits'],
])
log.message(`${dim(`tools: ${toolNamesOf(plugins, asking).join(', ')}`)}\n${help}`, { spacing: 0 })

// The key is only needed to send, so its absence is pointed out without blocking anything else
if (!conversation.agent.model.hasEnvKey) {
  log.warn(MISSING_KEY)
}

await quitting
conversation.stop()
await replying

await screen.settled()
screen.stop()
outro('Bye')
