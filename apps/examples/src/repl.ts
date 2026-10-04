// Minimal REPL: DEEPSEEK_API_KEY=sk-... pnpm --filter @ji.dev/examples repl
//
//   Enter sends; replies stream in, with one line per tool call and one per result as each call finishes
//   Ctrl+C during a reply stops only that reply; Ctrl+C at the prompt or /exit quits
//   DEEPSEEK_MODEL=deepseek-v4-pro switches the model (default deepseek-v4-flash)
//   DEEPSEEK_THINKING=high turns thinking on (default off); /think <level> switches it mid-chat, thinking shows in gray
//   The model can read and edit the files under the directory the command was run from, and nothing outside it
//   Every change to a file is shown as a diff and waits for a yes; /approve turns the question off and on
//
// Everything comes from @ji.dev/llm: the model, its thinking levels and the events need nothing from pi-ai.
import type { Agent, Run, ThinkingLevel, ToolCall, ToolResultMessage, UsageTotals } from '@ji.dev/llm'
import type { Question } from '@ji.dev/plugin-approval'
import process from 'node:process'
import { styleText } from 'node:util'
import { cancel, intro, isCancel, log, outro, S_BAR, select, text } from '@clack/prompts'
import {
  createAgent,
  createSession,
  RunError,
  tool,
  Type,
  UnknownModelError,
  UnsupportedThinkingError,
} from '@ji.dev/llm'
import { approval } from '@ji.dev/plugin-approval'
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

/** Where the command was run from: pnpm --filter starts the script in the package's own directory. */
const ROOT = process.env.INIT_CWD ?? process.cwd()

/** read and edit, limited to the files under ROOT. */
const fileTools = files(localWorkspace(ROOT))

const TOOL_NAMES = [calc, now, ...(fileTools.tools ?? [])].map(t => t.name).join(', ')

/** The run rejects with this when the user presses Ctrl+C to stop a reply. */
const STOPPED = new Error('stopped by user')

/** The reply being written, if any: what Ctrl+C stops. */
let current: Run | undefined

/**
 * One status line: icon, label, and seconds waited.
 * Not clack's spinner: it puts stdin in raw mode, so Ctrl+C would exit the process instead of stopping the reply.
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

/** /approve toggles it; "yes, and stop asking" turns it off. */
let approving = true

/** The question on screen, if any; settled otherwise. */
let question: Promise<unknown> = Promise.resolve()

/**
 * Asks before a call runs. The approval plugin knows nothing about files: fileTools.preview tells it what a call would
 * change, so only changes to files are asked about. Leaving the plugin out is how approval is switched off for good.
 */
const approvals = approval({ ask, previews: [fileTools.preview] })

function ask({ title, detail }: Question): Promise<boolean | string> {
  if (!approving) {
    return Promise.resolve(true)
  }

  const answer = (async () => {
    status.hide()
    if (detail !== undefined) {
      log.message(paintDiff(detail), { symbol: styleText('yellow', '±') })
    }
    const choice = await select({
      message: `${title}?`,
      options: [
        { value: 'yes', label: 'Yes' },
        { value: 'always', label: 'Yes, and stop asking', hint: '/approve turns it back on' },
        { value: 'no', label: 'No' },
      ],
    })
    // Ctrl+C at the question stops the whole reply, like Ctrl+C anywhere else in it
    if (isCancel(choice)) {
      current?.abort(STOPPED)
      return false
    }
    if (choice === 'always') {
      approving = false
    }
    return choice === 'no' ? 'The user rejected this change. Ask what they want instead.' : true
  })()
  question = answer.catch(() => {})
  return answer
}

/** Resolves once no question is on screen, so nothing is drawn over one. */
async function answered(): Promise<void> {
  for (let seen; seen !== question;) {
    seen = question
    await seen
  }
}

function paintDiff(patch: string): string {
  const color = (line: string): string =>
    line.startsWith('+') ? styleText('green', line) : line.startsWith('-') ? styleText('red', line) : dim(line)
  return patch.split('\n').map(color).join('\n')
}

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
async function render(r: Run): Promise<void> {
  const started = performance.now()
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
          break
        case 'thinking':
        case 'text':
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
          status.hide()
          log.message(describeResult(e.result), {
            symbol: e.result.isError ? styleText('red', '✗') : styleText('green', '✓'),
            spacing: 0,
          })
          wait(running.size > 0 ? runningLabel() : 'Waiting')
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
  log.message(dim(`${seconds}s · ${describeUsage(usage)}`))
}

/** pi-ai's input excludes cache hits, so the prompt tokens sent to the model = input + cacheRead + cacheWrite. */
function describeUsage(usage: UsageTotals): string {
  const prompt = usage.input + usage.cacheRead + usage.cacheWrite
  const rate = prompt === 0 ? 0 : Math.round((usage.cacheRead / prompt) * 100)
  const n = (x: number): string => x.toLocaleString('en-US')
  return `in ${n(prompt)} · out ${n(usage.output)} · cached ${n(usage.cacheRead)} (${rate}%) · $${usage.cost.toFixed(4)}`
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
  const body = clip(result.content.map(c => (c.type === 'text' ? c.text : `[${c.type}]`)).join(''))
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
      thinking: (process.env.DEEPSEEK_THINKING ?? 'off') as ThinkingLevel,
      system: `You are a concise assistant running in a terminal. Use tools when they help. File paths are relative to ${ROOT}.`,
      tools: [calc, now],
      plugins: [fileTools, approvals],
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
const MISSING_KEY =
  'DEEPSEEK_API_KEY is not set. Quit with /exit, run `export DEEPSEEK_API_KEY=sk-...`, and start again.'

// clack handles Ctrl+C at the prompt (returning a cancel), so SIGINT only arrives here mid-reply
process.on('SIGINT', () => (current ? current.abort(STOPPED) : process.exit(130)))

intro(`ji · ${agent.model.provider}/${agent.model.id}`)
log.message(
  dim(
    `thinking: ${agent.thinking} · tools: ${TOOL_NAMES} · files: ${ROOT}\n/think <${levels}> · /approve · Ctrl+C stops a reply · /exit quits`,
  ),
  { spacing: 0 },
)
// The key is only needed to send, so its absence is pointed out without blocking anything else
if (!agent.model.hasEnvKey) {
  log.warn(MISSING_KEY)
}

/** After a stop or an error, the unanswered message goes back into the input to edit and resend. */
let retry = ''

for (;;) {
  const input = await text({ message: 'You', placeholder: 'Ask anything', initialValue: retry })
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
  if (message === '/approve') {
    approving = !approving
    log.success(`Approval before file changes: ${approving ? 'on' : 'off'}`)
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
  current = chat.send(message)
  try {
    await render(current)
  } catch (error) {
    // Roll back to before the send, so the next message doesn't pick up this unanswered one
    chat = createSession(agent, { state: before })
    retry = message
    if (error instanceof RunError && error.kind === 'aborted' && error.cause === STOPPED) {
      log.warn('Stopped. Your message is back in the input. Edit it or clear it.')
    } else {
      log.error(
        `${error instanceof Error ? error.message : String(error)}\nYour message is back in the input. Press Enter to retry.`,
      )
    }
  } finally {
    current = undefined
  }
}

outro('Bye')
