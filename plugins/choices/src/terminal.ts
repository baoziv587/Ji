// @ji.dev/plugin-choices/terminal: answers questions in a terminal, drawn like the rest of clack
//
//   choices({ answer: terminal({ paint: colorDiff }) })
//
//   choosing.ts     what each key does to the questions being answered
//   draw            how that state looks: a pure function of it
//   ChoicesPrompt   clack's prompt around the two, which reads the keys and writes the frames
//
// Esc dismisses the questions; Ctrl+C is a SIGINT, as anywhere else in a terminal program.

import type { State } from '@clack/core'
import type { Choosing } from './choosing.ts'
import type { Answers, Question, Questions, Reply } from './index.ts'
import { once } from 'node:events'
import process from 'node:process'
import { styleText } from 'node:util'
import { isCancel, Prompt, wrapTextWithPrefix } from '@clack/core'
import {
  log,
  S_BAR,
  S_BAR_END,
  S_CHECKBOX_ACTIVE,
  S_CHECKBOX_INACTIVE,
  S_CHECKBOX_SELECTED,
  S_RADIO_ACTIVE,
  S_RADIO_INACTIVE,
  symbol,
} from '@clack/prompts'
import { onOther, onSend, press, sent, start } from './choosing.ts'
import { DISMISSED } from './index.ts'

export interface TerminalOptions {
  /** How a detail is drawn: a diff in colors, say. Default: as it is. */
  paint?: (detail: string) => string
}

/** An `answer` for choices: it always answers, so no question reaches the layers outside. */
export function terminal({ paint = detail => detail }: TerminalOptions = {}): (
  questions: Questions,
  signal: AbortSignal,
) => Promise<Reply> {
  return async ({ questions }, signal) => {
    // One question's detail may be a long diff, so it goes above the prompt instead of being redrawn on every key
    const [first] = questions
    if (questions.length === 1 && first.detail !== undefined) {
      log.message(paint(first.detail))
    }

    const prompt = new ChoicesPrompt(questions, paint, signal)
    const answers = await prompt.prompt()
    if (!isCancel(answers) && answers !== undefined) {
      return answers
    }

    signal.throwIfAborted()
    if (prompt.interrupted) {
      // The prompt reads keys raw, so Ctrl+C reached it as a key: it is passed on as the signal it would have been
      process.kill(process.pid, 'SIGINT')
      await once(signal, 'abort')
      throw signal.reason
    }
    return DISMISSED
  }
}

/** Where the prompt is: still open, or closed by sending, by Esc, or by the signal or Ctrl+C. */
type Phase = 'open' | 'sent' | 'dismissed' | 'stopped'

interface Look {
  paint: (detail: string) => string
  /** Wraps text to the terminal: `first` before the first line, `prefix` before the rest. */
  wrap: (text: string, prefix: string, first: string) => string
}

/** The whole frame: the symbol and a head, then lines on a rail; an open frame ends with the rail's end. */
function draw(s: Choosing, phase: Phase, look: Look): string {
  const several = s.questions.length > 1
  const title = several ? headers(s).join(dim(' · ')) : s.questions[0].title

  if (phase === 'sent') {
    const lines = several ? s.questions.map((q, i) => `${q.title} ${dim(describe(s, i))}`) : [dim(describe(s, 0))]
    return frame(title, lines, 'submit', 'gray', look)
  }
  if (phase !== 'open') {
    // Stopped, the reply was stopped or the question is about to show again: nothing was dismissed
    const lines = phase === 'dismissed' ? [styleText(['strikethrough', 'dim'], 'dismissed')] : []
    return `${frame(title, lines, 'cancel', 'gray', look)}\n${styleText('gray', S_BAR)}`
  }

  const failed = s.error !== undefined
  const color = failed ? 'yellow' : 'cyan'
  const head = several ? tabBar(s) : title
  const body = onSend(s) ? review(s) : options(s, look.paint)
  const footer = failed ? styleText('yellow', s.error) : dim(keys(s))
  return `${frame(head, [...body, footer], failed ? 'error' : 'active', color, look)}\n${styleText(color, S_BAR_END)}\n`
}

/** Every line wrapped to the terminal, so a redraw counts the lines right. */
function frame(head: string, lines: string[], state: State, color: 'gray' | 'cyan' | 'yellow', look: Look): string {
  const bar = `${styleText(color, S_BAR)}  `
  return [
    styleText('gray', S_BAR),
    look.wrap(head, bar, `${symbol(state)}  `),
    ...lines.map(line => look.wrap(line, bar, bar)),
  ].join('\n')
}

/** ← Storage  ✓ Auth  Send →, the current one inverted. */
function tabBar(s: Choosing): string {
  const tabs = [...headers(s), 'Send'].map((name, i) => {
    const mark = s.answers.at(i) === undefined ? '' : `${styleText('green', '✓')} `
    return i === s.tab ? styleText('inverse', ` ${mark}${name} `) : ` ${mark}${dim(name)} `
  })
  return `${dim('←')}${tabs.join('')}${dim('→')}`
}

/** A row per option and one for Other; with several questions, the question and its detail above them. */
function options(s: Choosing, paint: (detail: string) => string): string[] {
  const question = s.questions[s.tab]
  const row = s.rows[s.tab]
  const picked = s.picked[s.tab]

  const lines = question.options.map((o, j) => {
    const hint = o.hint === undefined ? '' : ` ${dim(`(${o.hint})`)}`
    const label = j === row ? o.label : dim(o.label)
    return `${mark(question, j === row, picked.includes(o.value))} ${label}${hint}`
  })
  if (question.other === true) {
    const typed = s.typed[s.tab]
    const active = onOther(s)
    const text = typed === '' ? dim('Other: type an answer') : typed
    const cursor = active ? styleText('inverse', ' ') : ''
    lines.push(`${mark(question, active, typed !== '')} ${text}${cursor}`)
  }

  if (s.questions.length === 1) {
    return lines
  }
  const detail = question.detail === undefined ? [] : paint(question.detail).split('\n')
  return [styleText('bold', question.title), ...detail, ...lines]
}

/** The Send tab: every answer so far, and which are missing. */
function review(s: Choosing): string[] {
  return s.questions.map((q, i) => {
    const done = s.answers[i] !== undefined
    const mark = done ? styleText('green', '✓') : styleText('yellow', '!')
    return `${mark} ${q.title} ${dim(done ? describe(s, i) : 'not answered')}`
  })
}

function keys(s: Choosing): string {
  const esc = 'Esc dismisses'
  if (onSend(s)) {
    return ['Enter sends', '←/→ questions', esc].join(' · ')
  }

  const several = s.questions.length > 1
  return [
    '↑/↓ choose',
    s.questions[s.tab].multiple === true ? 'Space picks' : '',
    several ? '←/→ questions' : '',
    several ? 'Enter next' : 'Enter confirms',
    esc,
  ]
    .filter(part => part !== '')
    .join(' · ')
}

function headers(s: Choosing): string[] {
  return s.questions.map((q, i) => q.header ?? `Question ${i + 1}`)
}

/** An answer by its labels: `Postgres`, `OAuth, SSO`, or `(none)`. */
function describe(s: Choosing, i: number): string {
  const answer = s.answers[i] ?? []
  const labels = answer.map(value => s.questions[i].options.find(o => o.value === value)?.label ?? value)
  return labels.length === 0 ? '(none)' : labels.join(', ')
}

/** A radio for one choice, a checkbox for several; green once picked, cyan under the cursor. */
function mark(question: Question, active: boolean, picked: boolean): string {
  if (question.multiple !== true) {
    return active ? styleText('green', S_RADIO_ACTIVE) : dim(S_RADIO_INACTIVE)
  }
  if (picked) {
    return styleText('green', S_CHECKBOX_SELECTED)
  }
  return active ? styleText('cyan', S_CHECKBOX_ACTIVE) : dim(S_CHECKBOX_INACTIVE)
}

function dim(s: string): string {
  return styleText('dim', s)
}

/** Holds a Choosing, passes each key to press, and draws whatever it becomes. */
class ChoicesPrompt extends Prompt<Answers> {
  interrupted = false
  private choosing: Choosing
  private closed = false
  private readonly look: Look
  private readonly signal: AbortSignal

  constructor(questions: Question[], paint: (detail: string) => string, signal: AbortSignal) {
    super(
      {
        signal,
        render(this: unknown) {
          const prompt = this as ChoicesPrompt
          return draw(prompt.choosing, prompt.phase(), prompt.look)
        },
      },
      false,
    )
    this.choosing = start(questions)
    this.look = { paint, wrap: (text, prefix, first) => wrapTextWithPrefix(this.output, text, prefix, first) }
    this.signal = signal

    this.on('key', (char, key) => {
      if (key.ctrl === true && key.name === 'c') {
        this.interrupted = true
        return
      }
      this.choosing = press(this.choosing, { ...key, char })
    })

    // Added before clack's own listener, which closes the prompt without drawing it, so the open frame would stay.
    // render is private to clack; were it gone, the prompt would only lose this last frame
    signal.addEventListener(
      'abort',
      () => {
        this.state = 'cancel'
        const render: unknown = Reflect.get(this, 'render')
        if (typeof render === 'function') {
          render.call(this)
        }
      },
      { once: true },
    )
  }

  /** Read by Prompt right after the 'key' event, so it sees what this Enter did. */
  protected override _shouldSubmit(): boolean {
    if (this.choosing.done) {
      this._setValue(sent(this.choosing))
    }
    return this.choosing.done
  }

  /** Once: a key that aborts the signal still reaches the prompt it closed, which would close it again. */
  protected override close(): void {
    if (!this.closed) {
      this.closed = true
      super.close()
    }
  }

  private phase(): Phase {
    if (this.state === 'submit') {
      return 'sent'
    }
    if (this.state === 'cancel') {
      return this.interrupted || this.signal.aborted ? 'stopped' : 'dismissed'
    }
    return 'open'
  }
}
