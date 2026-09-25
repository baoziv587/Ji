// 极简 REPL：DEEPSEEK_API_KEY=sk-... pnpm --filter @gaoxiang.ai/examples repl
//
//   回车发送；回答边生成边显示，工具调用和结果各占一行
//   回答中按 Ctrl+C 只停止这一次回答；在输入框按 Ctrl+C 或输入 /exit 退出
//   DEEPSEEK_MODEL=deepseek-v4-pro 换模型（默认 deepseek-v4-flash）
//   DEEPSEEK_THINKING=high 打开思考（默认 off）；对话中用 /think <档位> 切换，思考过程灰色显示
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
    // eslint-disable-next-line no-new-func -- expr 已被上面的白名单正则限制为纯算术
    return String(new Function(`return (${expr})`)())
  },
})

const now = tool({
  name: 'now',
  description: 'Get the current local date and time.',
  parameters: Type.Object({}),
  run: () => new Date().toString(),
})

/** 用户按 Ctrl+C 停止回答时，run 以它 reject */
const STOPPED = new Error('stopped by user')

/* ── 显示一次运行 ─────────────────────────────────────── */

/**
 * 等待时显示状态行；思考和文字边生成边写出；工具调用在参数完整时显示，结果在执行完时显示。
 * 每种内容的形状和颜色都不同，不只靠颜色区分：
 *   ◌ Thinking / ┊ 灰色斜体    思考
 *   │ 正常颜色                 回答
 *   ▸ 青色 name(args)         工具输入
 *   ✓ 绿色 / ✗ 红色            工具输出
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
        // 同一回合的多个调用连在一起，不空行
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

/** pi-ai 的 input 不含缓存命中的部分，所以发给模型的提示 token = input + cacheRead + cacheWrite */
function describeUsage(usage: UsageTotals): string {
  const prompt = usage.input + usage.cacheRead + usage.cacheWrite
  const rate = prompt === 0 ? 0 : Math.round((usage.cacheRead / prompt) * 100)
  const n = (x: number): string => x.toLocaleString('en-US')
  return `in ${n(prompt)} · out ${n(usage.output)} · cached ${n(usage.cacheRead)} (${rate}%) · $${usage.cost.toFixed(4)}`
}

/** 写成函数调用：calc(expr: "17*23") */
function describeCall(call: ToolCall): string {
  const args = Object.entries(call.arguments)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join(', ')
  return `${styleText('bold', call.name)}${dim('(')}${clip(args)}${dim(')')}`
}

/** 工具名灰色，结果用正常颜色（出错时红色），和灰色的思考、统计区分开 */
function describeResult(result: ToolResultMessage): string {
  const body = clip(result.content.map(c => (c.type === 'text' ? c.text : `[${c.type}]`)).join(''))
  return `${dim(result.toolName)}  ${result.isError ? styleText('red', body) : body}`
}

/** 压成一行，并按终端宽度截断，避免折行打断左侧竖线 */
function clip(s: string): string {
  const max = Math.max(40, (process.stdout.columns || 80) - 16)
  const line = s.replaceAll(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

type BlockKind = 'thinking' | 'text'

/** 每种文字块的样式：标题行（可选）、左侧竖线、文字 */
const BLOCKS: Record<BlockKind, { title?: string; rail: string; paint: (s: string) => string }> = {
  thinking: {
    title: `${styleText('gray', '◌')}  ${styleText(['dim', 'italic'], 'Thinking')}`,
    rail: styleText('gray', '┊'),
    paint: s => styleText(['dim', 'italic'], s),
  },
  text: { rail: bar(), paint: s => s },
}

/** 把流式文字写在 clack 的竖线右侧，和上下的提示框对齐。思考和回答各成一块 */
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
        // 空行也画竖线，段落之间不断开
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

  /** 结束当前文字块，让下一个输出从新的一行开始 */
  end(): void {
    if (this.open && !this.atLineStart) {
      process.stdout.write('\n')
    }
    this.open = undefined
    this.atLineStart = true
  }
}

/**
 * 单行状态：图标 + 说明 + 已等待的秒数。
 * 不用 clack 的 spinner：它把 stdin 切到 raw 模式，Ctrl+C 会直接退出进程，而不是停止这次回答。
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
    process.stdout.write('\x1B[?25l') // 隐藏光标
    this.draw()
    this.timer = setInterval(() => this.draw(), 80)
  }

  hide(): void {
    if (this.timer === undefined) {
      return
    }

    clearInterval(this.timer)
    this.timer = undefined
    process.stdout.write('\r\x1B[2K\x1B[?25h') // 清掉这一行，恢复光标
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

/** 读用户给的档位；不在这个模型的可用档位里就返回 undefined */
function parseThinking(model: Model<Api>, value: string): ModelThinkingLevel | undefined {
  return getSupportedThinkingLevels(model).find(level => level === value)
}

/** agent 不含状态：换档位就换一个 agent，会话从同一个状态继续 */
function agentFor(model: Model<Api>, thinking: ModelThinkingLevel): Agent {
  return createAgent({
    model,
    system: 'You are a concise assistant running in a terminal. Use tools when they help.',
    tools: [calc, now],
    reasoning: thinking === 'off' ? undefined : thinking,
  })
}

/* ── 主循环（放在最后：上面的 class 声明要先求值） ── */

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

// 输入框里的 Ctrl+C 由 clack 处理（返回 cancel）；这里只在回答进行中收到
let current: Run | undefined
process.on('SIGINT', () => (current ? current.abort(STOPPED) : process.exit(130)))

intro(`ji · ${model.provider}/${model.id}`)
log.message(
  dim(
    `thinking: ${thinking} · tools: calc, now\n/think <${levels.replaceAll(', ', '|')}> · Ctrl+C stops a reply · /exit quits`,
  ),
  { spacing: 0 },
)

/** 停止或出错后，把没完成的那条消息填回输入框，改一改再发 */
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
    // 回到发送前：这条消息不留在历史里，下一条不会接着回答它
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
