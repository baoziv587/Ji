// Putting every question to the person: whether a call may run, with the mode and the shortcuts a yes can take, or a
// question of the model's own. While one is open the keys are its own; switching the mode shows it again under the
// new one.

import type { ToolCall } from '@ji.dev/llm'
import type { Questions, Reply } from '@ji.dev/plugin-choices'
import type { Screen, Status } from '@ji.dev/tui'
import type { Approval, Permissions } from '../plugins/permissions.ts'
import { styleText } from 'node:util'
import { terminal } from '@ji.dev/plugin-choices/terminal'
import { detectLanguage, dimText, formatKeyHint, loadCodePainter, paintDiff } from '@ji.dev/tui'

/** The ask closes with this when the mode switches, to show the question again under the new one. */
const SWITCHED = new Error('mode switched')

export class Answering {
  private readonly screen: Screen
  private readonly status: Status
  private readonly permissions: Permissions
  /** The question on screen, if any; settled otherwise. */
  private question: Promise<unknown> = Promise.resolve()
  private showing = false
  /** Set while a question is on screen. */
  private onModeSwitch: (() => void) | undefined

  constructor(screen: Screen, status: Status, permissions: Permissions) {
    this.screen = screen
    this.status = status
    this.permissions = permissions
  }

  /**
   * For choices: Esc dismisses a question, and Ctrl+C stops the reply through the keypress listener. The live rows wait
   * while it is open: a question draws itself again by moving up over its own rows.
   */
  readonly answer = (q: Questions, signal: AbortSignal): Promise<Reply> => {
    this.screen.live.pause()
    const reply = this.choose(q, signal)
    this.showing = true
    this.question = reply
      .catch(() => {})
      .finally(() => {
        this.showing = false
        this.screen.live.resume()
        this.screen.draw()
      })
    return reply
  }

  /** While a question is on screen, the keys are its own, not the input line's. */
  get open(): boolean {
    return this.showing
  }

  /** Resolves once no question is on screen, so nothing is drawn over one. */
  async answered(): Promise<void> {
    for (let seen; seen !== this.question;) {
      seen = this.question
      await seen
    }
  }

  /** At the prompt or at a question: one open stays open, and shows again. */
  switchMode(): void {
    this.permissions.switchMode()
    this.onModeSwitch?.()
    this.screen.draw()
  }

  private async choose(q: Questions, signal: AbortSignal): Promise<Reply> {
    this.status.show('Waiting for your answer')
    const approval = q.call === undefined ? undefined : await this.permissions.approval(q.call)
    const ask = terminal({ paint: await this.painterFor(q.call), input: this.screen.keys })

    let asked = q
    for (;;) {
      const switched = new AbortController()
      this.onModeSwitch = () => switched.abort(SWITCHED)
      try {
        const shown = approval === undefined ? asked : this.withApproval(asked, approval)
        const reply = await ask(shown, AbortSignal.any([signal, switched.signal]))
        return approval === undefined ? reply : approval.take(reply)
      } catch (error) {
        if (error !== SWITCHED || signal.aborted) {
          throw error
        }
      } finally {
        this.onModeSwitch = undefined
        // A question's prompt pauses the keys when it closes
        this.screen.keys.resume()
      }
      // Shown again, without the detail already above it
      asked = { ...asked, questions: asked.questions.map(x => ({ ...x, detail: undefined })) }
    }
  }

  /**
   * After the title, whether the call reaches outside the workspace, the mode, and how to switch it; between Yes and
   * No, the shortcuts the mode allows. Built again after every switch of the mode.
   */
  private withApproval(q: Questions, approval: Approval): Questions {
    const [only] = q.questions
    const [yes, no] = only.options

    // The riskiest kind of call, so it is the one question that stands out
    const outside = approval.outside ? ` ${styleText('yellow', '(outside the workspace)')}` : ''
    const mode = dimText(`· ${this.permissions.describeMode()} ·`)
    const title = `${only.title}${outside}? ${mode} ${formatKeyHint('Shift+Tab', 'switches')}`

    const options = [yes, ...approval.shortcuts(), no]
    return { ...q, questions: [{ ...only, title, options }] }
  }

  /** How a question's detail is drawn: a command as shell, a diff in the colors of the file it changes. */
  private async painterFor(call: ToolCall | undefined): Promise<(detail: string) => string> {
    if (call !== undefined && this.permissions.isCommand(call)) {
      const start = await loadCodePainter('bash')
      return command => {
        const paint = start()
        return command
          .split('\n')
          .map(line => paint(line))
          .join('\n')
      }
    }

    const path: unknown = call?.arguments.path
    const start = await loadCodePainter(typeof path === 'string' ? detectLanguage(path) : undefined)
    return patch => paintDiff(patch, start)
  }
}
