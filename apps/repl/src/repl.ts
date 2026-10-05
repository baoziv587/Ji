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
//   The model can ask questions of its own, with options it writes; Esc dismisses any question
//
// Everything comes from @ji.dev/llm: the model, its thinking levels and the events need nothing from pi-ai.
import type { Agent, AgentState, Message, Run, ThinkingLevel, ToolCall, ToolResultMessage } from '@ji.dev/llm'
import type { Option, Preview, Questions, Reply } from '@ji.dev/plugin-choices'
import type { Writable } from 'node:stream'
import type { Editing, Keypress } from './editing.ts'
import type { Frame } from './screen.ts'
import process from 'node:process'
import { emitKeypressEvents } from 'node:readline'
import { styleText } from 'node:util'
import { cancel, log, outro, S_BAR } from '@clack/prompts'
import {
  createAgent,
  createSession,
  RunError,
  tool,
  Type,
  UnknownModelError,
  UnsupportedThinkingError,
} from '@ji.dev/llm'
import { choices, DISMISSED } from '@ji.dev/plugin-choices'
import { terminal } from '@ji.dev/plugin-choices/terminal'
import { files, localWorkspace } from '@ji.dev/plugin-files'
import { createLocalExecutor, createSearchPlugin, createShellPlugin } from '@ji.dev/plugin-shell'
import truncatedWidth from 'fast-string-truncated-width'
import { edit, EMPTY, textOf } from './editing.ts'
import { Screen } from './screen.ts'
import { count, Meter } from './usage.ts'

const calc = tool({
  name: 'calc',
  description: 'Evaluate an arithmetic expression, e.g. "2*(3+4)".',
  parameters: Type.Object({ expr: Type.String() }),
  run: ({ expr }) => {
    if (!/^[\d\s+\-*/().]+$/.test(expr)) {
      throw new Error(`bad expr: ${expr}`)
    }
    // eslint-disable-next-line no-new-func -- the allowlist regex above limits expr to plain arithmetic
    return String(new Function(`return (${expr})`)())
  },
})

const now = tool({
  name: 'now',
  description: 'Get the current local date and time.',
  parameters: Type.Object({}),
  run: () => new Date().toString(),
})

// What is asked about: the files the model may touch, and the mode Shift+Tab switches

/** Where the command was run from: pnpm --filter starts the script in the package's own directory. */
const ROOT = process.env.INIT_CWD ?? process.cwd()

/** read and edit, on any file: what lies outside ROOT is asked about, not refused. */
const fileTools = files(localWorkspace(ROOT, { allow: () => true }))

/** Used only to tell where a path leads: it refuses every path outside ROOT. */
const rooted = localWorkspace(ROOT)

const FILE_TOOLS = new Set(fileTools.tools?.map(t => t.name))

/** bash and grep, run in ROOT. Before the files plugin: a command runs after the edits the model wrote before it. */
const executor = createLocalExecutor({ cwd: ROOT })
const shellTools = createShellPlugin(executor)
const searchTools = createSearchPlugin(executor)

/** Shift+Tab switches it, at the prompt or at a question. */
let mode: 'ask' | 'auto' = 'ask'

/** In ask mode, until the person answers a read with "stop asking about reads". */
let askReads = true

/** Starts with the mode's name, the word the help line uses for it. */
function describeMode(): string {
  if (mode === 'auto') {
    return 'auto: approves file calls inside the workspace, asks about the rest'
  }
  return `ask: before every command and file ${askReads ? 'read and change' : 'change'}`
}

/** The files plugin's preview covers only changes; reads are asked about too. */
const reading: Preview = call => (call.name === 'read' ? { title: `Read ${String(call.arguments.path)}` } : undefined)

/**
 * Which file calls are asked about: inside ROOT, only what the mode asks about; outside it, always, so auto mode never
 * reaches past ROOT unseen. The mode decides what is asked, not how it is answered: every question goes to the person.
 */
const fileCalls: Preview = async (call, signal) => {
  const far = await outsideRoot(call)
  if (!far && (mode === 'auto' || (call.name === 'read' && !askReads))) {
    return undefined
  }

  const proposal = (await fileTools.preview(call, signal)) ?? (await reading(call, signal))
  if (!far || proposal === undefined || 'role' in proposal) {
    return proposal
  }
  // The riskiest kind of call, so it is the one question that stands out, and a yes has to be chosen
  return { ...proposal, title: `${proposal.title} ${styleText('yellow', '(outside the workspace)')}`, initial: 'no' }
}

async function outsideRoot(call: ToolCall): Promise<boolean> {
  const path: unknown = call.arguments.path
  if (!FILE_TOOLS.has(call.name) || typeof path !== 'string') {
    return false
  }
  return rooted.resolve(path).then(
    () => false,
    () => true,
  )
}

/**
 * The model asks with ask_user; fileCalls says which file calls wait for a yes, and every command does (RFC-0007 §5).
 * None of them knows about the terminal: `answer` puts every question to the person.
 */
const asking = choices({ answer, approve: [fileCalls, shellTools.preview] })

// The terminal: the bars, the reply in progress and its status, shared by the question and the reply

/** The run rejects with this when the user presses Ctrl+C to stop a reply. */
const STOPPED = new Error('stopped by user')

/** The reply being written, if any: what Ctrl+C stops, and what Enter steers. */
let current: Run | undefined

/** The bars around the conversation; drawn by drawFrame. */
const screen = new Screen(drawFrame)

/** What the session has spent, on the line above the status. */
const meter = new Meter()

/** What the reply is doing and for how long, spun in the bar while a reply runs. */
class Status {
  private static readonly frames = ['◒', '◐', '◓', '◑']
  private timer: NodeJS.Timeout | undefined
  private label = ''
  private detail = ''
  private since = 0
  private frame = 0

  /** A different label starts its own count; the detail, a tool's progress say, does not. */
  show(label: string, detail = ''): void {
    if (label !== this.label) {
      this.label = label
      this.since = performance.now()
    }
    this.detail = detail
    this.timer ??= setInterval(() => {
      this.frame++
      screen.draw()
    }, 80)
    screen.draw()
  }

  hide(): void {
    clearInterval(this.timer)
    this.timer = undefined
    this.label = ''
    screen.draw()
  }

  /** `◐ Running calc 2s`, or empty while hidden. */
  describe(): string {
    if (this.timer === undefined) {
      return ''
    }

    const icon = styleText('magenta', Status.frames[this.frame % Status.frames.length])
    const seconds = Math.floor((performance.now() - this.since) / 1000)
    const detail = this.detail === '' ? '' : ` · ${this.detail}`
    return `${icon} ${this.label} ${dim(`${seconds}s`)}${detail}`
  }
}

const status = new Status()

// Asking the person

/** Draws the questions; Esc dismisses them, and Ctrl+C stops the reply through the keypress listener. */
const ask = terminal({ paint: paintDiff, input: screen.keys })

/** A yes that also changes what is asked from now on: what Shift+Tab or a second question would otherwise take. */
const SHORTCUTS = {
  auto: { value: 'auto', label: 'Yes, and approve the rest inside the workspace' },
  reads: { value: 'reads', label: 'Yes, and stop asking about reads inside the workspace' },
}

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
  const far = q.call !== undefined && (await outsideRoot(q.call))

  let shown = q
  for (;;) {
    const switched = new AbortController()
    onModeSwitch = () => switched.abort(SWITCHED)
    try {
      const reply = await ask(
        q.call === undefined ? shown : approval(shown, far),
        AbortSignal.any([signal, switched.signal]),
      )
      return q.call === undefined ? reply : takeShortcut(reply)
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

/** The approval as the person sees it: the mode it is asked under, and the shortcuts that mode offers. */
function approval(q: Questions, far: boolean): Questions {
  const [only] = q.questions
  const [yes, no] = only.options
  const shortcuts: Option[] = []
  if (mode === 'ask' && !far) {
    shortcuts.push(SHORTCUTS.auto)
    if (q.call?.name === 'read') {
      shortcuts.push(SHORTCUTS.reads)
    }
  }
  const title = `${only.title}? ${dim(`· ${describeMode()} ·`)} ${hint('Shift+Tab', 'switches')}`
  return { ...q, questions: [{ ...only, title, options: [yes, ...shortcuts, no] }] }
}

function takeShortcut(reply: Reply): Reply {
  const value = reply === DISMISSED ? undefined : reply[0][0]
  if (value === SHORTCUTS.auto.value) {
    mode = 'auto'
  } else if (value === SHORTCUTS.reads.value) {
    askReads = false
  } else {
    return reply
  }
  return [['yes']]
}

/** Resolves once no question is on screen, so nothing is drawn over one. */
async function answered(): Promise<void> {
  for (let seen; seen !== question;) {
    seen = question
    await seen
  }
}

function switchMode(): void {
  mode = mode === 'ask' ? 'auto' : 'ask'
  onModeSwitch?.()
  screen.draw()
}

/** Every hunk in its own colors; the diff has no context lines, see paintHunk. */
function paintDiff(patch: string): string {
  return patch
    .split(/\n(?=@@)/)
    .map(paintHunk)
    .join('\n')
}

/**
 * Without context lines a hunk is its removed lines, then its added ones: the k-th added line replaced the k-th
 * removed one, so the part where the two differ is underlined.
 */
function paintHunk(hunk: string): string {
  const [header, ...lines] = hunk.split('\n')
  const removed = lines.filter(line => line.startsWith('-'))
  const added = lines.filter(line => line.startsWith('+'))

  const body = lines.map((line, i) => {
    if (line.startsWith('-')) {
      return underlineChange(line, added[i], 'red')
    }
    if (line.startsWith('+')) {
      return underlineChange(line, removed[i - removed.length], 'green')
    }
    return dim(line)
  })
  return [styleText('cyan', header), ...body].join('\n')
}

/** The line in `color`, with what differs from `other` underlined; skips the leading + or -. */
function underlineChange(line: string, other: string | undefined, color: 'green' | 'red'): string {
  if (other === undefined) {
    return styleText(color, line)
  }

  let start = 1
  while (start < line.length && line[start] === other[start]) {
    start++
  }
  let end = 0
  while (end < line.length - start && end < other.length - start && line.at(-1 - end) === other.at(-1 - end)) {
    end++
  }

  const stop = line.length - end
  const same = (part: string): string => styleText(color, part)
  const changed = styleText([color, 'underline'], line.slice(start, stop))
  return `${same(line.slice(0, start))}${changed}${same(line.slice(stop))}`
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
 *   |                                          |                          <- blank line before a turn's first call
 *                                              >  calc(expr: "17*23")     <- tool_call: the tool has not started yet
 *   v  calc(expr: "17*23")                     v  calc  391               <- tool_end: green, or red x with the error
 *   +  use vitest  · steer                     +  use vitest  · steer     <- a message, once it reaches the model
 *
 * The status (Running calc 1s) is in the bar, timed from tool_start, so it never counts time the model was writing.
 */
async function render(r: Run, changed: Set<string>): Promise<void> {
  const out = new Gutter()
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
          out.write(e.delta, 'thinking')
          status.show('Thinking', out.describeThought())
          break
        case 'text':
          meter.streaming()
          status.show('Writing')
          out.write(e.delta, 'text')
          break
        case 'tool_call':
          out.end()
          // Calls from the same turn stay together without blank lines
          log.message(describeCall(e.call), {
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
          log.message(describeResult(e.result), { symbol, spacing: 0, output: screen.full })
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

/** Formats as a call: calc(expr: "17*23") */
function describeCall(call: ToolCall): string {
  const args = Object.entries(call.arguments)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join(', ')
  return `${styleText('bold', call.name)}${dim('(')}${clip(args)}${dim(')')}`
}

/** A message's text; images and other parts by their type. */
function contentOf(m: Message): string {
  if (typeof m.content === 'string') {
    return m.content
  }
  return m.content.map(c => (c.type === 'text' ? c.text : `[${c.type}]`)).join('')
}

/** Dim tool name and normal-colored result (red on error), to stand apart from the dim thinking. */
function describeResult(result: ToolResultMessage): string {
  const body = clip(resultText(result))
  return `${dim(result.toolName)}  ${result.isError ? styleText('red', body) : body}`
}

/** The brief view's one line for a call: the call itself, and on error what went wrong, since that matters. */
function describeDone(call: ToolCall, result: ToolResultMessage): string {
  if (!result.isError) {
    return describeCall(call)
  }
  return `${describeCall(call)}  ${styleText('red', clip(resultText(result)))}`
}

function resultText(result: ToolResultMessage): string {
  return result.content.map(c => (c.type === 'text' ? c.text : `[${c.type}]`)).join('')
}

/** Collapses to one line clipped to the terminal width, so wrapping doesn't break the left rail. */
function clip(s: string): string {
  const max = Math.max(40, (process.stdout.columns || 80) - 16)
  const line = s.replaceAll(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

type BlockKind = 'thinking' | 'text'

interface Block {
  title?: string
  rail: string
  paint: (s: string) => string
  output: Writable
}

/** Thinking is written in full to the full view only; the brief one gets a line for it once it ends. */
const BLOCKS: Record<BlockKind, Block> = {
  thinking: {
    title: `${styleText('gray', '◌')}  ${styleText(['dim', 'italic'], 'Thinking')}`,
    rail: styleText('gray', '┊'),
    paint: s => styleText(['dim', 'italic'], s),
    output: screen.full,
  },
  text: { rail: bar(), paint: s => s, output: process.stdout },
}

/** Enough of the thinking's end to fill the status. */
const RECENT = 200

/**
 * Writes streamed text to the right of clack's rail, lined up with the prompts above and below. Thinking and
 * answer text each get their own block. The rail is written lazily, when a line gets its first text or turns out
 * to be blank, so a chunk ending in '\n' leaves no dangling rail and end() knows whether a line is still open.
 */
class Gutter {
  private open: BlockKind | undefined
  private atLineStart = true
  /** The thinking block in progress: how long and how much, and its last words for the status. */
  private thought: { since: number; chars: number; recent: string } | undefined

  write(chunk: string, kind: BlockKind): void {
    const { title, rail, paint, output } = BLOCKS[kind]
    if (this.open !== kind) {
      this.end()
      output.write(`${bar()}\n${title === undefined ? '' : `${title}\n`}`)
      this.open = kind
    }

    if (kind === 'thinking') {
      this.thought ??= { since: performance.now(), chars: 0, recent: '' }
      this.thought.chars += [...chunk].length
      this.thought.recent = (this.thought.recent + chunk).slice(-RECENT)
    }

    chunk.split('\n').forEach((part, i) => {
      if (i > 0) {
        // Blank lines get a rail too, so paragraphs stay connected
        output.write(this.atLineStart ? `${rail}\n` : '\n')
        this.atLineStart = true
      }
      if (part === '') {
        return
      }
      if (this.atLineStart) {
        output.write(`${rail}  `)
        this.atLineStart = false
      }
      output.write(paint(part))
    })
  }

  /** `1.2k chars · …so I'll call calc`: how much it has thought, and its last words; empty while not thinking. */
  describeThought(): string {
    if (this.thought === undefined) {
      return ''
    }

    const words = this.thought.recent.replaceAll(/\s+/g, ' ').trim()
    return dim(`${count(this.thought.chars)} chars · …${tail(words, 48)}`)
  }

  /** Closes the current block so the next output starts on a fresh line; a thinking one gets its line in brief. */
  end(): void {
    if (this.open && !this.atLineStart) {
      BLOCKS[this.open].output.write('\n')
    }

    if (this.thought !== undefined) {
      const seconds = Math.max(1, Math.round((performance.now() - this.thought.since) / 1000))
      const title = styleText(['dim', 'italic'], `Thought for ${seconds}s`)
      const length = dim(`· ${count(this.thought.chars)} chars`)
      screen.brief.write(`${bar()}\n${styleText('gray', '◌')}  ${title} ${length}\n`)
      this.thought = undefined
    }

    this.open = undefined
    this.atLineStart = true
  }
}

function bar(): string {
  return styleText('gray', S_BAR)
}

function dim(s: string): string {
  return styleText('dim', s)
}

/** A key and what it does. */
type Hint = [key: string, action: string]

/**
 * The key in bold, so it stands out from the dim words around it; in `color` too where its part of the line has one.
 * Weight, not a color of its own: the colors already say who or what (cyan you, yellow a warning).
 */
function hint(key: string, action: string, color?: 'cyan' | 'yellow'): string {
  if (color === undefined) {
    return `${styleText('bold', key)} ${dim(action)}`
  }
  return `${styleText([color, 'bold'], key)} ${styleText(color, action)}`
}

function hints(list: Hint[]): string {
  return list.map(([key, action]) => hint(key, action)).join(dim(' · '))
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
  const label = mode === 'auto' ? styleText('yellow', describeMode()) : dim(describeMode())
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

  return [details, status.describe(), below, label, waiting, hints(keys)].filter(part => part !== '').join(dim(' · '))
}

/** The prompt, then the text around the cursor, scrolled sideways to keep the cursor in view. */
function inputLine(width: number): { line: string; column: number } {
  const prompt = `${styleText(questionOpen ? 'gray' : 'cyan', '›')} `
  const room = width - 2
  if (textOf(editing) === '') {
    return { line: prompt + fit(dim(placeholder()), room), column: 2 }
  }

  // At least the cursor's own cell stays free after the text before it
  const left = tail(editing.before, room - 1)
  const right = fit(editing.after, room - widthOf(left))
  const paint = questionOpen ? dim : (s: string): string => s
  return { line: prompt + paint(left + right), column: 2 + widthOf(left) }
}

function placeholder(): string {
  if (questionOpen) {
    return 'Answer the question above'
  }
  return current === undefined ? 'Ask anything' : 'Steer the reply: it reads this after the step in progress'
}

function widthOf(text: string): number {
  return truncatedWidth(text).width
}

/**
 * As much of the start of `text` as fits in `width` columns. The ellipsis's column is kept apart: given one, the library
 * returns an index of -Infinity when the cut falls on a color code.
 */
function fit(text: string, width: number): string {
  if (widthOf(text) <= width) {
    return text
  }

  const { index } = truncatedWidth(text, { limit: width - 1 })
  return `${text.slice(0, index)}\x1B[0m…`
}

/** As much of the end of `text` as fits in `width` columns. */
function tail(text: string, width: number): string {
  let start = text.length
  let used = 0
  for (const { segment, index } of [...new Intl.Segmenter().segment(text)].reverse()) {
    used += widthOf(segment)
    if (used > width) {
      break
    }
    start = index
  }
  return text.slice(start)
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
