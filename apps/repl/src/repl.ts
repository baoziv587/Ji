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
import type { Agent, AgentState, Message, Run, ThinkingLevel, ToolCall } from '@ji.dev/llm'
import type { Questions, Reply } from '@ji.dev/plugin-choices'
import type { Editing, Keypress } from './editing.ts'
import type { Frame } from './screen.ts'
import type { Hint } from './text.ts'
import process from 'node:process'
import { emitKeypressEvents } from 'node:readline'
import { styleText } from 'node:util'
import { cancel, log, outro } from '@clack/prompts'
import { createAgent, createSession, RunError, UnknownModelError, UnsupportedThinkingError } from '@ji.dev/llm'
import { choices } from '@ji.dev/plugin-choices'
import { terminal } from '@ji.dev/plugin-choices/terminal'
import { files, localWorkspace } from '@ji.dev/plugin-files'
import { createLocalExecutor, createSearchPlugin, createShellPlugin } from '@ji.dev/plugin-shell'
import { describeArguments, describeDone, describeResult } from './calls.ts'
import { paintDiff } from './diff.ts'
import { edit, EMPTY, textOf } from './editing.ts'
import { Gutter } from './gutter.ts'
import { languageOf, loadLanguage } from './highlight.ts'
import { Permissions } from './permissions.ts'
import { Screen } from './screen.ts'
import { Status } from './status.ts'
import { clip, dim, fit, hint, hints, tail, widthOf } from './text.ts'
import { calc, now } from './tools.ts'
import { Meter } from './usage.ts'

// The plugins, and what of theirs is asked about

/** Where the command was run from: pnpm --filter starts the script in the package's own directory. */
const ROOT = process.env.INIT_CWD ?? process.cwd()

/** read and edit, on any file: what lies outside ROOT is asked about, not refused. */
const fileTools = files(localWorkspace(ROOT, { allow: () => true }))

const FILE_TOOLS = new Set(fileTools.tools?.map(t => t.name))

/** bash and grep, run in ROOT. Before the files plugin: a command runs after the edits the model wrote before it. */
const executor = createLocalExecutor({ cwd: ROOT })
const shellTools = createShellPlugin(executor)
const searchTools = createSearchPlugin(executor)

/** What waits for a yes; Shift+Tab switches its mode, at the prompt or at a question. */
const permissions = new Permissions(ROOT, fileTools, shellTools)

/**
 * The model asks with ask_user; permissions say which calls wait for a yes (RFC-0007 §5). None of them knows about the
 * terminal: `answer` puts every question to the person.
 */
const asking = choices({ answer, approve: permissions.approve })

// The terminal: the bars, the reply in progress and its status, shared by the question and the reply

/** The run rejects with this when the user presses Ctrl+C to stop a reply. */
const STOPPED = new Error('stopped by user')

/** The reply being written, if any: what Ctrl+C stops, and what Enter steers. */
let current: Run | undefined

/** The bars around the conversation; drawn by drawFrame. */
const screen = new Screen(drawFrame)

/** What the session has spent, on the line above the status. */
const meter = new Meter()

const status = new Status(() => screen.draw())

// Asking the person

/** The ask closes with this when Shift+Tab switches the mode, to show the question again under the new one. */
const SWITCHED = new Error('mode switched')

/** Set while a question is on screen. */
let onModeSwitch: (() => void) | undefined

/** The question on screen, if any; settled otherwise. */
let question: Promise<unknown> = Promise.resolve()

/** While a question is on screen, the keys are its own, not the input line's. */
let questionOpen = false

function answer(q: Questions, signal: AbortSignal): Promise<Reply> {
  const reply = choose(q, signal)
  questionOpen = true
  question = reply
    .catch(() => {})
    .finally(() => {
      questionOpen = false
      screen.draw()
    })
  return reply
}

async function choose(q: Questions, signal: AbortSignal): Promise<Reply> {
  status.show('Waiting for your answer')
  const approval = q.call === undefined ? undefined : await permissions.approval(q.call)
  // Draws the questions; Esc dismisses them, and Ctrl+C stops the reply through the keypress listener
  const ask = terminal({ paint: await painterFor(q.call), input: screen.keys })

  let shown = q
  for (;;) {
    const switched = new AbortController()
    onModeSwitch = () => switched.abort(SWITCHED)
    try {
      const reply = await ask(approval?.show(shown) ?? shown, AbortSignal.any([signal, switched.signal]))
      return approval === undefined ? reply : approval.take(reply)
    } catch (error) {
      if (error !== SWITCHED || signal.aborted) {
        throw error
      }
    } finally {
      onModeSwitch = undefined
      // A question's prompt pauses the keys when it closes
      screen.keys.resume()
    }
    // Switching the mode leaves the question open: it shows again, without the detail already above it
    shown = { ...shown, questions: shown.questions.map(x => ({ ...x, detail: undefined })) }
  }
}

/** How a question's detail is drawn: a command as shell, a diff in the colors of the file it changes. */
async function painterFor(call: ToolCall | undefined): Promise<(detail: string) => string> {
  if (call !== undefined && permissions.isCommand(call)) {
    const start = await loadLanguage('bash')
    return command => {
      const paint = start()
      return command
        .split('\n')
        .map(line => paint(line))
        .join('\n')
    }
  }

  const path: unknown = call?.arguments.path
  const start = await loadLanguage(typeof path === 'string' ? languageOf(path) : undefined)
  return patch => paintDiff(patch, start)
}

/** Resolves once no question is on screen, so nothing is drawn over one. */
async function answered(): Promise<void> {
  for (let seen; seen !== question;) {
    seen = question
    await seen
  }
}

function switchMode(): void {
  permissions.switchMode()
  onModeSwitch?.()
  screen.draw()
}

// Showing a reply

/**
 * Maps run events to terminal lines, in two views (Ctrl+O switches). ASCII stand-ins for the real glyphs; every kind
 * differs in shape as well as color, so the output still reads without color.
 *
 *   brief, by default                          full
 *
 *   |                                          |                          <- Gutter opens a block with a bare rail
 *   o  Thought for 4s · 1.2k chars             o  Thinking                <- title
 *                                              :  The user wants 17*23    <- thinking: gray rail, dim italic text
 *   |                                          |
 *   |  Let me compute that.                    |  Let me compute that.    <- text: plain rail, normal text
 *   |  ```ts                                   |  ```ts                   <- a code block, in color a line at a time
 *   |                                          |                          <- blank line before a turn's first call
 *                                              >  calc                    <- tool_call: the tool has not started yet,
 *                                              |  expr: "17*23"              an argument a line
 *   v  calc(expr: "17*23")                     v  calc  391               <- tool_end: green, or red x with the error
 *   +  use vitest  · steer                     +  use vitest  · steer     <- a message, once it reaches the model
 *
 * Every line of a call or a result is cut to one row, so a long one never wraps under the rail. The status (Running
 * calc 1s) is in the bar, timed from tool_start, so it never counts time the model was writing.
 */
async function render(r: Run, changed: Set<string>): Promise<void> {
  const out = new Gutter(screen)
  const running = new Map<string, string>()
  // Each view's first tool line in a turn has a blank line before it
  let afterCall = false
  let afterDone = false

  const runningLabel = (): string => `Running ${[...new Set(running.values())].join(', ')}`

  status.show('Waiting')
  try {
    for await (const e of r) {
      await answered()
      switch (e.type) {
        case 'step_end':
          if (e.turn.kind === 'input') {
            out.end()
            // A message sent while the agent was busy steered it; one sent while idle simply started its turn
            const steer = e.turn.idle ? '' : dim('  · steer')
            for (const m of e.turn.messages) {
              log.message(`${styleText('bold', contentOf(m))}${steer}`, { symbol: styleText('cyan', '●') })
            }
            afterCall = false
            afterDone = false
          }
          break
        case 'model_start':
          // The level actually sent, after any plugin and after mapping to what the model supports
          status.show(e.thinking === 'off' ? 'Waiting' : 'Thinking')
          afterCall = false
          afterDone = false
          if (e.by === undefined) {
            meter.start()
          }
          break
        case 'thinking':
          meter.streaming()
          await out.write(e.delta, 'thinking')
          status.show('Thinking', out.describeThought())
          break
        case 'text':
          meter.streaming()
          status.show('Writing')
          await out.write(e.delta, 'text')
          break
        case 'tool_call':
          out.end()
          // Calls from the same turn stay together without blank lines
          log.message(describeArguments(e.call), {
            symbol: styleText('cyan', '▸'),
            spacing: afterCall ? 0 : 1,
            output: screen.full,
          })
          afterCall = true
          break
        case 'tool_start':
          running.set(e.call.id, e.call.name)
          status.show(runningLabel())
          break
        case 'tool_update':
          status.show(runningLabel(), clip(String(e.data)))
          break
        case 'tool_end': {
          running.delete(e.call.id)
          if (!e.result.isError && e.call.name !== 'read' && FILE_TOOLS.has(e.call.name)) {
            changed.add(String(e.call.arguments.path))
          }

          const symbol = e.result.isError ? styleText('red', '✗') : styleText('green', '✓')
          log.message(await describeResult(e.call, e.result), { symbol, spacing: 0, output: screen.full })
          log.message(describeDone(e.call, e.result), { symbol, spacing: afterDone ? 0 : 1, output: screen.brief })
          afterDone = true

          status.show(running.size > 0 ? runningLabel() : 'Waiting')
          break
        }
        case 'model_end':
          meter.end(e.message.usage)
          break
        case 'model_error':
          meter.dropped(e.usage)
          break
        case 'step_cancelled':
          meter.dropped()
          running.clear()
          break
      }
    }
  } finally {
    status.hide()
    out.end()
  }
}

/** A message's text; images and other parts by their type. */
function contentOf(m: Message): string {
  if (typeof m.content === 'string') {
    return m.content
  }
  return m.content.map(c => (c.type === 'text' ? c.text : `[${c.type}]`)).join('')
}

/** The model and level are checked here, so a typo stops the REPL before the first prompt, with the choices listed. */
function startAgent(): Agent {
  try {
    return createAgent({
      model: `deepseek/${process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash'}`,
      thinking: (process.env.DEEPSEEK_THINKING ?? 'high') as ThinkingLevel,
      system: `You are a concise assistant running in a terminal. Use tools when they help. File paths are relative to ${ROOT}.`,
      tools: [calc, now],
      plugins: [shellTools, searchTools, fileTools, asking],
    })
  } catch (error) {
    if (error instanceof UnknownModelError || error instanceof UnsupportedThinkingError) {
      cancel(error.message)
      process.exit(1)
    }
    throw error
  }
}

// The main loop comes last because the class declarations above must be evaluated before render() runs.

let agent = startAgent()
let chat = createSession(agent)

const levels = agent.model.thinkingLevels.join('|')
const TOOL_NAMES = [calc, now, ...[shellTools, searchTools, fileTools, asking].flatMap(p => p.tools ?? [])]
  .map(t => t.name)
  .join(', ')
const MISSING_KEY =
  'DEEPSEEK_API_KEY is not set. Quit with /exit, run `export DEEPSEEK_API_KEY=sk-...`, and start again.'

/** The input line. */
let editing: Editing = EMPTY

/** What the reply in progress was sent: its first message, then every steer. They go back in the input if it stops. */
let sent: string[] = []

/** The reply in progress, settled once it has written its last line. */
let replying: Promise<void> = Promise.resolve()

const { promise: quitting, resolve: quit } = Promise.withResolvers<void>()

/** Enter: a command, a new reply, or a steer for the one in progress. */
function submit(): void {
  const message = textOf(editing).trim()
  if (message !== '' && !message.startsWith('/') && !agent.model.hasEnvKey) {
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

  // 'step' reaches the model at the next step boundary: at once when idle, after the step in progress otherwise
  const before = chat.state
  const run = chat.send(message, { when: 'step' })
  if (run === current) {
    sent.push(message)
    screen.draw()
    return
  }
  sent = [message]
  replying = converse(run, before)
}

function think(arg: string): void {
  const level = agent.model.thinkingLevels.find(l => l === arg)
  if (level === undefined) {
    log.info(`Thinking: ${agent.thinking}. Change it with /think <${levels}>.`)
    return
  }
  // Same conversation, new setting: the next model call uses it, in a reply in progress too
  agent = agent.with({ thinking: level })
  chat.use(agent)
  log.success(`Thinking: ${agent.thinking}`)
}

async function converse(run: Run, before: AgentState): Promise<void> {
  current = run
  const changed = new Set<string>()
  try {
    await render(run, changed)
  } catch (error) {
    // Roll back to before the reply, so the next message doesn't pick up these unanswered ones
    chat = createSession(agent, { state: before })
    // Ahead of whatever was typed since, so nothing typed is lost
    editing = { ...EMPTY, before: [...sent, textOf(editing)].filter(t => t !== '').join(' ') }

    const back = sent.length === 1 ? 'Your message is back in the input.' : 'Your messages are back in the input.'
    // The history goes back, the files do not: a resend should not take them for untouched
    const stays = changed.size === 1 ? 'stays' : 'stay'
    const kept = changed.size === 0 ? '' : `${[...changed].join(', ')} ${stays} changed. `
    if (error instanceof RunError && error.kind === 'aborted' && error.cause === STOPPED) {
      log.warn(`Stopped. ${kept}${back} Edit it or clear it.`)
    } else {
      log.error(`${error instanceof Error ? error.message : String(error)}\n${kept}${back} Press Enter to retry.`)
    }
  } finally {
    current = undefined
    screen.draw()
  }
}

/** Ctrl+C: stops the reply; with none, clears the input; with an empty input, quits. */
function interrupt(): void {
  if (current !== undefined) {
    current.abort(STOPPED)
  } else if (textOf(editing) !== '') {
    editing = EMPTY
    screen.draw()
  } else {
    quit()
  }
}

/**
 * On top, the model and its settings; at the bottom, the status line and the input line with the cursor in it. Both
 * bars keep a blank row at the terminal's edge and a column on each side of their text; only the rules run across.
 */
function drawFrame(columns: number): Frame {
  // Short of the last column, so no line wraps
  const width = columns - 1
  const inner = width - 2
  const rule = dim('─'.repeat(width))

  const title = `${styleText('bold', 'ji')} ${dim('·')} ${agent.model.provider}/${agent.model.id}`
  const settings = dim(` · thinking ${agent.thinking} · ${ROOT}`)
  const input = inputLine(inner)

  return {
    top: ['', ` ${fit(title + settings, inner)}`, rule],
    bottom: [usageRule(width), ` ${fit(statusLine(), inner)}`, ` ${input.line}`, ''],
    // Hidden while a question is open: the keys are its own
    cursor: questionOpen ? undefined : { row: 2, column: input.column + 1 },
  }
}

/** A rule with the session's usage at its right end, as much of it as fits; a plain one before any model call. */
function usageRule(width: number): string {
  const parts = meter.parts()
  for (let shown = parts.length; shown > 0; shown--) {
    const label = ` ${parts.slice(0, shown).join(' · ')} `
    const left = width - widthOf(label) - 1
    if (left >= 8) {
      return dim(`${'─'.repeat(left)}${label}─`)
    }
  }
  return dim('─'.repeat(width))
}

/**
 * The view, if it is the full one; what runs and for how long, what is scrolled past, the mode, the steers not yet
 * delivered, the keys that matter now.
 */
function statusLine(): string {
  let details = ''
  if (screen.view === 'full') {
    details = `${styleText('cyan', 'details')} ${hint('Ctrl+O', 'hides', 'cyan')}`
  }

  // auto is the less careful mode, so it stands out in the warning color
  const mode = permissions.describeMode()
  const label = permissions.mode === 'auto' ? styleText('yellow', mode) : dim(mode)
  // So is whatever a yes allowed, until switching back to ask takes it back
  const allowing = permissions.describeAllowed()
  const allows = allowing === '' ? '' : styleText('yellow', allowing)
  const queued = current === undefined ? 0 : chat.pending.length
  const waiting = queued === 0 ? '' : styleText('cyan', `${queued} queued`)

  let below = ''
  if (screen.below > 0) {
    below = `${styleText('yellow', `↓ ${screen.below} more lines`)} ${styleText(['yellow', 'bold'], 'PgDn')}`
  }

  let keys: Hint[] = [
    ['Enter', 'steers'],
    ['Ctrl+C', 'stops'],
  ]
  if (questionOpen) {
    // Its keys are its own, listed under it; Ctrl+C still stops the whole reply
    keys = [['Ctrl+C', 'stops']]
  }
  if (current === undefined) {
    keys = [
      ['Shift+Tab', 'switches'],
      ['/exit', 'quits'],
    ]
  }
  if (current === undefined && screen.view === 'brief') {
    keys = [['Ctrl+O', 'details'], ...keys]
  }

  return [details, status.describe(), below, label, allows, waiting, hints(keys)]
    .filter(part => part !== '')
    .join(dim(' · '))
}

/** The prompt, then the text around the cursor, scrolled sideways to keep the cursor in view. */
function inputLine(width: number): { line: string; column: number } {
  const prompt = `${styleText(questionOpen ? 'gray' : 'cyan', '›')} `
  const space = width - 2
  if (textOf(editing) === '') {
    return { line: prompt + fit(dim(placeholder()), space), column: 2 }
  }

  // At least the cursor's own cell stays free after the text before it
  const left = tail(editing.before, space - 1)
  const right = fit(editing.after, space - widthOf(left))
  const paint = questionOpen ? dim : (s: string): string => s
  return { line: prompt + paint(left + right), column: 2 + widthOf(left) }
}

function placeholder(): string {
  if (questionOpen) {
    return 'Answer the question above'
  }
  return current === undefined ? 'Ask anything' : 'Steer the reply: it reads this after the step in progress'
}

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  cancel('The REPL draws a bar at the bottom of a terminal: run it in one.')
  process.exit(1)
}

// Whatever ends the process, the terminal is given back
process.on('exit', () => screen.stop())

// Ctrl+C reaches the keypress listener as a key; the SIGINT comes from a question's prompt, which passes it on
process.on('SIGINT', () => {
  if (current === undefined) {
    process.exit(130)
  }
  current.abort(STOPPED)
})

// This listener is added before any question's, so the question redraws after a mode switch and shows the new mode.
// Pastes come between markers, so a pasted line break does not send.
emitKeypressEvents(screen.keys)
screen.keys.on('keypress', (char: string | undefined, key: (Keypress & { shift?: boolean }) | undefined) => {
  if (key?.name === 'pageup' || key?.name === 'pagedown') {
    screen.page(key.name === 'pageup' ? -1 : 1)
    return
  }
  if (key?.name === 'tab' && key.shift === true) {
    switchMode()
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
  if (questionOpen) {
    return
  }
  if (key?.name === 'return' && !editing.pasting) {
    submit()
    return
  }
  editing = edit(editing, { ...key, char })
  screen.draw()
})

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
log.message(`${dim(`tools: ${TOOL_NAMES}`)}\n${help}`, { spacing: 0 })

// The key is only needed to send, so its absence is pointed out without blocking anything else
if (!agent.model.hasEnvKey) {
  log.warn(MISSING_KEY)
}

await quitting
current?.abort(STOPPED)
await replying

await screen.settled()
screen.stop()
outro('Bye')
