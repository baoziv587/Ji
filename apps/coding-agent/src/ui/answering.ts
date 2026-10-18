// Putting the session's questions to the person, one at a time, as the service asks them: whether a call may run, with
// the mode and the shortcuts a yes can take, a question of the model's own, or a login's prompt. While one is open the
// keys are its own; a switch of the mode shows it again under the new one, and one answered elsewhere, in the desktop
// app say, or closed with its reply, goes away.

import type { Question, Reply } from '@ji.dev/plugin-choices'
import type { Screen, Status } from '@ji.dev/tui'
import type { Readable } from 'node:stream'
import type { QuestionView, ServiceEvent, ServiceState } from '../server/events.ts'
import { styleText } from 'node:util'
import { isCancel, log, password, text } from '@clack/prompts'
import { DISMISSED } from '@ji.dev/plugin-choices'
import { terminal } from '@ji.dev/plugin-choices/terminal'
import { detectLanguage, dimText, formatKeyHint, loadCodePainter, paintDiff } from '@ji.dev/tui'
import { errorMessage } from '@ji.dev/utils'

export type Ask = Extract<ServiceEvent, { type: 'ask' }>

export interface AnsweringContext {
  screen: Screen
  status: Status
  /** The session's state now: its mode, and whether it is replying. */
  state: () => ServiceState
  answer: (id: string, reply: Reply) => Promise<void>
  /** Shift+Tab: between ask and auto. */
  switchMode: () => void
  /** Resolves once what the reply showed before a question is on screen, so the question comes after it. */
  drawn: () => Promise<void>
}

/** The prompt closes with this when the mode switches, to show the question again under the new one. */
const SWITCHED = new Error('mode switched')

/** The prompt closes with this when the question is no longer asked. */
const CLOSED = new Error('question closed')

/** The question on screen: what closes it, and, once it is a choice, what shows it again. */
interface Shown {
  id: string
  close: AbortController
  switched?: () => void
}

export class Answering {
  private readonly context: AnsweringContext
  /** The questions asked and not yet shown, oldest first. */
  private readonly waiting: Ask[] = []
  private shown: Shown | undefined
  /** Settled once no question is on screen. */
  private onScreen: Promise<void> = Promise.resolve()
  /** Showing the questions asked, one after the other. */
  private showing = false

  constructor(context: AnsweringContext) {
    this.context = context
  }

  /** While a question is on screen, the keys are its own, not the input line's. */
  get open(): boolean {
    return this.shown !== undefined
  }

  /** Resolves once no question is on screen, so nothing is drawn over one. */
  async answered(): Promise<void> {
    for (let seen; seen !== this.onScreen;) {
      seen = this.onScreen
      await seen
    }
  }

  /** Shows the question once those before it are answered. */
  ask(e: Ask): void {
    this.waiting.push(e)
    if (!this.showing) {
      void this.showAll()
    }
  }

  /** The question is no longer asked: it goes away, on screen or still waiting. */
  closed(id: string): void {
    const at = this.waiting.findIndex(e => e.id === id)
    if (at !== -1) {
      this.waiting.splice(at, 1)
    }
    if (this.shown?.id === id) {
      this.shown.close.abort(CLOSED)
    }
  }

  /** At the prompt or at a question: the session's mode switches, and the question shows again once it has. */
  switchMode(): void {
    this.context.switchMode()
  }

  /** The session's mode is not what it was: the question on screen shows again under the new one. */
  modeChanged(): void {
    this.shown?.switched?.()
  }

  /** Each question once what the reply showed before it is on screen: a reply waits on its own questions. */
  private async showAll(): Promise<void> {
    this.showing = true
    while (this.waiting.length > 0) {
      await this.context.drawn()
      // One closed meanwhile is gone
      const e = this.waiting.shift()
      if (e !== undefined) {
        this.onScreen = this.show(e)
        await this.onScreen
      }
    }
    this.showing = false
  }

  private async show(e: Ask): Promise<void> {
    const shown: Shown = { id: e.id, close: new AbortController() }
    this.shown = shown
    try {
      const reply = await this.hold(keys => this.choose(e, keys, shown))
      await this.context.answer(e.id, reply)
    } catch (error) {
      // Closed, or answered elsewhere first: the service has what it needs
      if (!shown.close.signal.aborted) {
        log.warn(`The answer did not reach the session: ${errorMessage(error)}`)
      }
    } finally {
      this.shown = undefined
    }
  }

  /** The keys are the question's own and the live rows wait while it is open: it draws itself again over its rows. */
  private async hold<T>(ask: (keys: Readable) => Promise<T>): Promise<T> {
    const { screen, status, state } = this.context
    screen.live.pause()
    try {
      return await ask(screen.keys)
    } finally {
      // A prompt pauses the keys when it closes
      screen.keys.resume()
      screen.live.resume()
      if (state().replying) {
        status.show('Waiting')
      } else {
        status.hide()
      }
      screen.draw()
    }
  }

  private async choose(e: Ask, keys: Readable, shown: Shown): Promise<Reply> {
    const { signal } = shown.close
    const [only] = e.questions
    if (e.questions.length === 1 && only.options.length === 0 && only.other) {
      return typed(only, keys, signal)
    }

    this.context.status.show('Waiting for your answer')
    const ask = terminal({ paint: await painterFor(e), input: keys })
    let questions: Question[] = e.questions
    for (;;) {
      const switched = new AbortController()
      shown.switched = () => switched.abort(SWITCHED)
      try {
        const asked = e.tool === undefined ? questions : this.withApproval(e, questions)
        return await ask({ questions: asked }, AbortSignal.any([signal, switched.signal]))
      } catch (error) {
        if (error !== SWITCHED || signal.aborted) {
          throw error
        }
      } finally {
        // A question's prompt pauses the keys when it closes
        keys.resume()
      }
      // Shown again, without the detail already above it
      questions = questions.map(q => ({ ...q, detail: undefined }))
    }
  }

  /** After the title, whether the call reaches outside the workspace, the mode, and how to switch it. */
  private withApproval(e: Ask, questions: Question[]): Question[] {
    const [only, ...rest] = questions
    // The riskiest kind of call, so it is the one question that stands out
    const outside = e.outside ? ` ${styleText('yellow', '(outside the workspace)')}` : ''
    const mode = dimText(`· ${this.context.state().modeDescription} ·`)
    return [{ ...only, title: `${only.title}${outside}? ${mode} ${formatKeyHint('Shift+Tab', 'switches')}` }, ...rest]
  }
}

/** A line to type, a key's in dots: Esc or Ctrl+C dismisses it. */
async function typed(q: QuestionView, input: Readable, signal: AbortSignal): Promise<Reply> {
  const common = { message: q.title, input, signal }
  const answered = q.secret === true ? await password(common) : await text({ ...common, placeholder: q.placeholder })
  signal.throwIfAborted()
  return isCancel(answered) ? DISMISSED : [[String(answered)]]
}

/** How a question's detail is drawn: a command as shell, a diff in the colors of the file it changes. */
async function painterFor(e: Ask): Promise<(detail: string) => string> {
  if (e.command === true) {
    const start = await loadCodePainter('bash')
    return command => {
      const paint = start()
      return command
        .split('\n')
        .map(line => paint(line))
        .join('\n')
    }
  }

  const start = await loadCodePainter(e.path === undefined ? undefined : detectLanguage(e.path))
  return patch => paintDiff(patch, start)
}
