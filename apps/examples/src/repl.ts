// Minimal REPL: DEEPSEEK_API_KEY=sk-... pnpm --filter @ji.dev/examples repl
//
//   Enter sends; replies stream in, with one line per tool call and one per result as each call finishes
//   Ctrl+C during a reply stops only that reply; Ctrl+C at the prompt or /exit quits
//   DEEPSEEK_MODEL=deepseek-v4-pro switches the model (default deepseek-v4-flash)
//   DEEPSEEK_THINKING=off turns thinking off (default high); /think <level> switches it mid-chat, thinking shows in gray
//   The model can read and edit files: every read, and every change shown as a diff, waits for a yes
//   Shift+Tab switches to auto-approve and back; auto-approve covers only the directory the command was run from, and
//   a call reaching outside it is still asked about, with No under the cursor
//   The model can ask questions of its own, with options it writes; Esc dismisses any question
//
// Everything comes from @ji.dev/llm: the model, its thinking levels and the events need nothing from pi-ai.
import type { Agent, Run, ThinkingLevel, ToolCall, ToolResultMessage, UsageTotals } from '@ji.dev/llm'
import type { Option, Preview, Questions, Reply } from '@ji.dev/plugin-choices'
import process from 'node:process'
import { emitKeypressEvents } from 'node:readline'
import { styleText } from 'node:util'
import { cancel, intro, isCancel, log, outro, S_BAR, text } from '@clack/prompts'
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

/** Shift+Tab switches it, at the prompt or at a question. */
let mode: 'ask' | 'auto' = 'ask'

/** In ask mode, until the person answers a read with "stop asking about reads". */
let askReads = true

/** Starts with the mode's name, the word the help line uses for it. */
function describeMode(): string {
  if (mode === 'auto') {
    return 'auto: approves inside the workspace, asks outside it'
  }
  return `ask: before every file ${askReads ? 'read and change' : 'change'}`
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
 * The model asks with ask_user, and fileCalls says which calls wait for a yes (RFC-0007 §5). Neither knows about the
 * terminal: `answer` puts every question to the person.
 */
const asking = choices({ answer, approve: [fileCalls] })

// The terminal: the reply in progress and the status line, shared by the question and the reply

/** The run rejects with this when the user presses Ctrl+C to stop a reply. */
const STOPPED = new Error('stopped by user')

/** The reply being written, if any: what Ctrl+C stops. */
let current: Run | undefined

/**
 * One status line: icon, label, and seconds waited.
 * Not clack's spinner: it takes Ctrl+C to exit the process instead of stopping the reply.
 */
class Status {
  private static readonly frames = ['◒', '◐', '◓', '◑']
  private timer: NodeJS.Timeout | undefined
  private label = ''
  private since = 0
  private frame = 0

  show(label: string): void {
    this.label = label
    if (this.timer !== undefined || !process.stdout.isTTY) {
      return
    }

    this.since = performance.now()
    process.stdout.write('\x1B[?25l') // hide the cursor
    this.draw()
    this.timer = setInterval(() => this.draw(), 80)
  }

  hide(): void {
    if (this.timer === undefined) {
      return
    }

    clearInterval(this.timer)
    this.timer = undefined
    process.stdout.write('\r\x1B[2K\x1B[?25h') // clear the line, show the cursor
  }

  private draw(): void {
    const icon = styleText('magenta', Status.frames[this.frame++ % Status.frames.length])
    const seconds = Math.floor((performance.now() - this.since) / 1000)
    process.stdout.write(`\r\x1B[2K${icon}  ${this.label} ${dim(`${seconds}s`)}`)
  }
}

/** One for the whole REPL: the approval question has to hide it too. */
const status = new Status()

// The spinner hides the cursor; whatever ends the process, it comes back
process.on('exit', () => status.hide())

/**
 * While a reply runs, keys are read raw, so Ctrl+C reaches the keypress listener as a key. As a SIGINT it would also
 * reach the parent process: `pnpm repl` would exit and leave the reply writing over the shell. A question's prompt
 * turns raw mode off when it closes, so it is turned on again after each one.
 */
function readKeys(on: boolean): void {
  if (!process.stdin.isTTY) {
    return
  }

  process.stdin.setRawMode(on)
  if (on) {
    process.stdin.resume()
  } else {
    process.stdin.pause()
  }
}

// Asking the person

/** Draws the questions; Esc dismisses them, and Ctrl+C stops the reply through the keypress listener. */
const ask = terminal({ paint: paintDiff })

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

function answer(q: Questions, signal: AbortSignal): Promise<Reply> {
  const reply = choose(q, signal)
  question = reply.catch(() => {})
  return reply
}

async function choose(q: Questions, signal: AbortSignal): Promise<Reply> {
  status.hide()
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
      // A question closed by the reply's end must not turn raw mode back on under the next prompt
      if (current !== undefined) {
        readKeys(true)
      }
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
  const title = `${only.title}? ${dim(`· ${describeMode()} · Shift+Tab switches`)}`
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
 * Maps run events to terminal lines. ASCII stand-ins for the real glyphs; every kind differs in shape as well as
 * color, so the output still reads without color.
 *
 *   |                          <- Gutter opens a block with a bare rail
 *   o  Thinking                <- title, thinking blocks only
 *   :  The user wants 17*23    <- thinking: gray rail, dim italic text
 *   |
 *   |  Let me compute that.    <- text: plain rail, normal text
 *   |                          <- blank line before the first call of a turn only
 *   >  calc(expr: "17*23")     <- tool_call: the arguments are complete; the tool has not started yet
 *   v  calc  391               <- tool_end: one line per call as soon as it finishes, green (or red x on error)
 *   @  Running calc 1s         <- Status: one line redrawn in place, erased before anything else is written;
 *                                 timed from tool_start, so it never counts time the model was still writing
 */
async function render(r: Run, changed: Set<string>): Promise<void> {
  const started = performance.now()
  const speed = new Speed()
  const out = new Gutter()
  const running = new Map<string, string>()
  let afterCall = false

  /** A different kind of wait starts its own timer. */
  const wait = (label: string): void => {
    status.hide()
    status.show(label)
  }
  const runningLabel = (): string => `Running ${[...new Set(running.values())].join(', ')}`

  wait('Waiting')
  try {
    for await (const e of r) {
      await answered()
      switch (e.type) {
        case 'model_start':
          // The level actually sent, after any plugin and after mapping to what the model supports
          wait(e.thinking === 'off' ? 'Waiting' : 'Thinking')
          afterCall = false
          speed.start()
          break
        case 'thinking':
        case 'text':
          speed.streaming()
          status.hide()
          out.write(e.delta, e.type)
          break
        case 'tool_call':
          status.hide()
          out.end()
          // Calls from the same turn stay together without blank lines
          log.message(describeCall(e.call), { symbol: styleText('cyan', '▸'), spacing: afterCall ? 0 : 1 })
          afterCall = true
          break
        case 'tool_start':
          running.set(e.call.id, e.call.name)
          wait(runningLabel())
          break
        case 'tool_update':
          status.show(`${runningLabel()} · ${clip(String(e.data))}`)
          break
        case 'tool_end':
          running.delete(e.call.id)
          if (!e.result.isError && e.call.name !== 'read' && FILE_TOOLS.has(e.call.name)) {
            changed.add(String(e.call.arguments.path))
          }
          status.hide()
          log.message(describeResult(e.result), {
            symbol: e.result.isError ? styleText('red', '✗') : styleText('green', '✓'),
            spacing: 0,
          })
          wait(running.size > 0 ? runningLabel() : 'Waiting')
          break
        case 'model_end':
          speed.end(e.message.usage.output)
          break
        case 'step_cancelled':
          running.clear()
          status.hide()
          break
      }
    }
  } finally {
    status.hide()
    out.end()
  }

  const { usage } = await r.summary
  const seconds = ((performance.now() - started) / 1000).toFixed(1)
  log.message(dim(`${seconds}s · ${describeUsage(usage, speed.describe())}`))
}

/**
 * Output tokens per second while the model writes: each call is timed from its first thinking or text, so the wait for
 * the first token is left out. A call that streams neither (only tool calls) is timed from its start.
 */
class Speed {
  private tokens = 0
  private ms = 0
  private from = 0
  private streamed = false

  start(): void {
    this.from = performance.now()
    this.streamed = false
  }

  streaming(): void {
    if (!this.streamed) {
      this.from = performance.now()
      this.streamed = true
    }
  }

  end(tokens: number): void {
    this.tokens += tokens
    this.ms += performance.now() - this.from
  }

  /** `38.4 tok/s`, or empty before any call has ended. */
  describe(): string {
    return this.ms > 0 ? `${((this.tokens / this.ms) * 1000).toFixed(1)} tok/s` : ''
  }
}

/** pi-ai's input excludes cache hits, so the prompt tokens sent to the model = input + cacheRead + cacheWrite. */
function describeUsage(usage: UsageTotals, speed: string): string {
  const prompt = usage.input + usage.cacheRead + usage.cacheWrite
  const rate = prompt === 0 ? 0 : Math.round((usage.cacheRead / prompt) * 100)
  const n = (x: number): string => x.toLocaleString('en-US')
  const out = speed === '' ? n(usage.output) : `${n(usage.output)} at ${speed}`
  return `in ${n(prompt)} · out ${out} · cached ${n(usage.cacheRead)} (${rate}%) · $${usage.cost.toFixed(4)}`
}

/** Formats as a call: calc(expr: "17*23") */
function describeCall(call: ToolCall): string {
  const args = Object.entries(call.arguments)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join(', ')
  return `${styleText('bold', call.name)}${dim('(')}${clip(args)}${dim(')')}`
}

/** Dim tool name and normal-colored result (red on error), to stand apart from the dim thinking and stats. */
function describeResult(result: ToolResultMessage): string {
  const text = result.content.map(c => (c.type === 'text' ? c.text : `[${c.type}]`)).join('')
  const body = clip(text)
  return `${dim(result.toolName)}  ${result.isError ? styleText('red', body) : body}`
}

/** Collapses to one line clipped to the terminal width, so wrapping doesn't break the left rail. */
function clip(s: string): string {
  const max = Math.max(40, (process.stdout.columns || 80) - 16)
  const line = s.replaceAll(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

type BlockKind = 'thinking' | 'text'

const BLOCKS: Record<BlockKind, { title?: string; rail: string; paint: (s: string) => string }> = {
  thinking: {
    title: `${styleText('gray', '◌')}  ${styleText(['dim', 'italic'], 'Thinking')}`,
    rail: styleText('gray', '┊'),
    paint: s => styleText(['dim', 'italic'], s),
  },
  text: { rail: bar(), paint: s => s },
}

/**
 * Writes streamed text to the right of clack's rail, lined up with the prompts above and below. Thinking and
 * answer text each get their own block. The rail is written lazily, when a line gets its first text or turns out
 * to be blank, so a chunk ending in '\n' leaves no dangling rail and end() knows whether a line is still open.
 */
class Gutter {
  private open: BlockKind | undefined
  private atLineStart = true

  write(chunk: string, kind: BlockKind): void {
    const { title, rail, paint } = BLOCKS[kind]
    if (this.open !== kind) {
      this.end()
      process.stdout.write(`${bar()}\n${title === undefined ? '' : `${title}\n`}`)
      this.open = kind
    }

    chunk.split('\n').forEach((part, i) => {
      if (i > 0) {
        // Blank lines get a rail too, so paragraphs stay connected
        process.stdout.write(this.atLineStart ? `${rail}\n` : '\n')
        this.atLineStart = true
      }
      if (part === '') {
        return
      }
      if (this.atLineStart) {
        process.stdout.write(`${rail}  `)
        this.atLineStart = false
      }
      process.stdout.write(paint(part))
    })
  }

  /** Closes the current block so the next output starts on a fresh line. */
  end(): void {
    if (this.open && !this.atLineStart) {
      process.stdout.write('\n')
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

/** The model and level are checked here, so a typo stops the REPL before the first prompt, with the choices listed. */
function startAgent(): Agent {
  try {
    return createAgent({
      model: `deepseek/${process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash'}`,
      thinking: (process.env.DEEPSEEK_THINKING ?? 'high') as ThinkingLevel,
      system: `You are a concise assistant running in a terminal. Use tools when they help. File paths are relative to ${ROOT}.`,
      tools: [calc, now],
      plugins: [fileTools, asking],
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
const TOOL_NAMES = [calc, now, ...(fileTools.tools ?? []), ...(asking.tools ?? [])].map(t => t.name).join(', ')
const MISSING_KEY =
  'DEEPSEEK_API_KEY is not set. Quit with /exit, run `export DEEPSEEK_API_KEY=sk-...`, and start again.'

// clack handles Ctrl+C at the prompt, and a reply reads it as a key; SIGINT comes only when stdin is not a terminal
process.on('SIGINT', () => {
  if (current === undefined) {
    process.exit(130)
  }
  current.abort(STOPPED)
})

// Keys arrive while a prompt, a question or a reply has stdin in raw mode. This listener is added before any prompt's,
// so the prompt redraws after the switch and shows the new mode.
emitKeypressEvents(process.stdin)
process.stdin.on('keypress', (_, key: { name?: string; shift?: boolean; ctrl?: boolean } | undefined) => {
  if (key?.name === 'tab' && key.shift === true) {
    switchMode()
  }
  if (key?.name === 'c' && key.ctrl === true) {
    current?.abort(STOPPED)
  }
})

const settings = `thinking: ${agent.thinking} · tools: ${TOOL_NAMES} · workspace: ${ROOT}`
const keys = `/think <${levels}> · Shift+Tab switches ask/auto · Esc dismisses a question · Ctrl+C stops a reply · /exit quits`
intro(`ji · ${agent.model.provider}/${agent.model.id}`)
log.message(dim(`${settings}\n${keys}`), { spacing: 0 })

// The key is only needed to send, so its absence is pointed out without blocking anything else
if (!agent.model.hasEnvKey) {
  log.warn(MISSING_KEY)
}

/** After a stop or an error, the unanswered message goes back into the input to edit and resend. */
let retry = ''

for (;;) {
  const input = await text({
    // Read on every redraw, so Shift+Tab shows at once
    get message() {
      // auto is the less careful mode, so it stands out in the warning color
      const label = `· ${describeMode()}`
      return `${styleText('bold', 'You')} ${mode === 'auto' ? styleText('yellow', label) : dim(label)}`
    },
    placeholder: 'Ask anything',
    initialValue: retry,
  })
  retry = ''

  if (isCancel(input)) {
    break
  }

  const message = (input ?? '').trim()
  if (message === '/exit') {
    break
  }
  if (message === '') {
    continue
  }
  if (message === '/think' || message.startsWith('/think ')) {
    const arg = message.slice('/think'.length).trim()
    const level = agent.model.thinkingLevels.find(l => l === arg)
    if (level) {
      // Same conversation, new setting: the next model call uses it
      agent = agent.with({ thinking: level })
      chat.use(agent)
      log.success(`Thinking: ${agent.thinking}`)
    } else {
      log.info(`Thinking: ${agent.thinking}. Change it with /think <${levels}>.`)
    }
    continue
  }
  if (!agent.model.hasEnvKey) {
    log.warn(MISSING_KEY)
    retry = message
    continue
  }

  const before = chat.state
  const changed = new Set<string>()
  current = chat.send(message)
  readKeys(true)
  try {
    await render(current, changed)
  } catch (error) {
    // Roll back to before the send, so the next message doesn't pick up this unanswered one
    chat = createSession(agent, { state: before })
    retry = message
    // The history goes back, the files do not: a resend should not take them for untouched
    const stays = changed.size === 1 ? 'stays' : 'stay'
    const kept = changed.size === 0 ? '' : `${[...changed].join(', ')} ${stays} changed. `
    if (error instanceof RunError && error.kind === 'aborted' && error.cause === STOPPED) {
      log.warn(`Stopped. ${kept}Your message is back in the input. Edit it or clear it.`)
    } else {
      log.error(
        `${error instanceof Error ? error.message : String(error)}\n${kept}Your message is back in the input. Press Enter to retry.`,
      )
    }
  } finally {
    current = undefined
    readKeys(false)
  }
}

outro('Bye')
