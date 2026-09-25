// Minimal REPL: DEEPSEEK_API_KEY=sk-... pnpm --filter @gaoxiang.ai/examples repl
//
//   Enter sends; replies stream in, with one line per tool call and one per result
//   Ctrl+C during a reply stops only that reply; Ctrl+C at the prompt or /exit quits
//   DEEPSEEK_MODEL=deepseek-v4-pro switches the model (default deepseek-v4-flash)
//   DEEPSEEK_THINKING=high turns thinking on (default off); /think <level> switches it mid-chat, thinking shows in gray
import type { Agent, Run, UsageTotals } from '@gaoxiang.ai/llm'
import type { Api, Model, ModelThinkingLevel, ToolCall, ToolResultMessage } from '@mariozechner/pi-ai'
import process from 'node:process'
import { styleText } from 'node:util'
import { cancel, intro, isCancel, log, outro, S_BAR, text } from '@clack/prompts'
import { createAgent, createSession, tool } from '@gaoxiang.ai/llm'
import { getModels, getSupportedThinkingLevels, Type } from '@mariozechner/pi-ai'

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

/** The run rejects with this when the user presses Ctrl+C to stop a reply. */
const STOPPED = new Error('stopped by user')

/**
 * Maps run events to terminal lines. ASCII stand-ins for the real glyphs; every kind differs in shape as well as
 * color, so the output still reads without color.
 *
 *   |                          <- Gutter opens a block with a bare rail
 *   o  Thinking                <- title, thinking blocks only
 *   :  The user wants 17*23    <- thinking_delta: gray rail, dim italic text
 *   |
 *   |  Let me compute that.    <- text_delta: plain rail, normal text
 *   |                          <- blank line before the first call of a turn only
 *   >  calc(expr: "17*23")     <- toolcall_end: shown once the arguments are complete
 *   v  calc  391               <- act: one line per result, green (or red x on error)
 *   @  Running calc 1s         <- Status: one line redrawn in place, erased before anything else is written
 */
async function render(r: Run): Promise<void> {
  const started = performance.now()
  const out = new Gutter()
  const status = new Status()
  let afterCall = false

  status.show('Waiting')
  try {
    for await (const e of r) {
      if (e.tag === 'delta' && e.delta.type === 'thinking_start') {
        status.show('Thinking')
      } else if (e.tag === 'delta' && e.delta.type === 'thinking_delta') {
        status.hide()
        out.write(e.delta.delta, 'thinking')
      } else if (e.tag === 'delta' && e.delta.type === 'text_delta') {
        status.hide()
        out.write(e.delta.delta, 'text')
      } else if (e.tag === 'delta' && e.delta.type === 'toolcall_end') {
        const call = e.delta.toolCall
        status.hide()
        out.end()
        // Calls from the same turn stay together without blank lines
        log.message(describeCall(call), {
          symbol: styleText('cyan', '▸'),
          spacing: afterCall ? 0 : 1,
        })
        afterCall = true
        status.show(`Running ${call.name}`)
      } else if (e.tag === 'act' && e.obs.length > 0) {
        status.hide()
        for (const result of e.obs) {
          log.message(describeResult(result), {
            symbol: result.isError ? styleText('red', '✗') : styleText('green', '✓'),
            spacing: 0,
          })
        }
        afterCall = false
        status.show('Waiting')
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

function bar(): string {
  return styleText('gray', S_BAR)
}

function dim(s: string): string {
  return styleText('dim', s)
}

function pickModel(id: string): Model<Api> {
  const found = getModels('deepseek').find(m => m.id === id)
  if (!found) {
    cancel(
      `Unknown DeepSeek model "${id}". Available: ${getModels('deepseek')
        .map(m => m.id)
        .join(', ')}`,
    )
    process.exit(1)
  }
  return found as Model<Api>
}

/** undefined when this model doesn't support the given level. */
function parseThinking(model: Model<Api>, value: string): ModelThinkingLevel | undefined {
  return getSupportedThinkingLevels(model).find(level => level === value)
}

/** Agents hold no state: a new level means a new agent, and the session continues from the same state. */
function agentFor(model: Model<Api>, thinking: ModelThinkingLevel): Agent {
  return createAgent({
    model,
    system: 'You are a concise assistant running in a terminal. Use tools when they help.',
    tools: [calc, now],
    reasoning: thinking === 'off' ? undefined : thinking,
  })
}

// The main loop comes last because the class declarations above must be evaluated before render() runs.

if (!process.env.DEEPSEEK_API_KEY) {
  cancel('DEEPSEEK_API_KEY is not set. Run `export DEEPSEEK_API_KEY=sk-...` and try again.')
  process.exit(1)
}

const model = pickModel(process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash')
const levels = getSupportedThinkingLevels(model).join(', ')

let thinking = parseThinking(model, process.env.DEEPSEEK_THINKING ?? 'off')
if (!thinking) {
  cancel(`DEEPSEEK_THINKING must be one of: ${levels}.`)
  process.exit(1)
}
let agent = agentFor(model, thinking)
let chat = createSession(agent)

// clack handles Ctrl+C at the prompt (returning a cancel), so SIGINT only arrives here mid-reply
let current: Run | undefined
process.on('SIGINT', () => (current ? current.abort(STOPPED) : process.exit(130)))

intro(`ji · ${model.provider}/${model.id}`)
log.message(
  dim(
    `thinking: ${thinking} · tools: calc, now\n/think <${levels.replaceAll(', ', '|')}> · Ctrl+C stops a reply · /exit quits`,
  ),
  { spacing: 0 },
)

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
  if (message === '/think' || message.startsWith('/think ')) {
    const level = parseThinking(model, message.slice('/think'.length).trim())
    if (level) {
      thinking = level
      agent = agentFor(model, level)
      chat = createSession(agent, { state: chat.state })
      log.success(`Thinking: ${level}`)
    } else {
      log.info(`Thinking: ${thinking}. Change it with /think <${levels.replaceAll(', ', '|')}>.`)
    }
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
    if (error === STOPPED) {
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
