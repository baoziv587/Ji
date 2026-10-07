// The line typed at the bottom, and what the keys do: Enter sends it as a message, a steer or a command, Ctrl+C stops
// the reply, clears the line or quits, and the rest edit it. A reply is followed to its end from here, so one that
// does not finish can put what it was sent back in the line.

import type { Run } from '@ji.dev/llm'
import type { Editing, Keypress, Screen } from '@ji.dev/tui'
import type { Conversation } from '../agent/conversation.ts'
import type { Answering } from './answering.ts'
import type { Menu } from './bars.ts'
import type { CommandMenu } from './menu.ts'
import type { Stage } from './reply/render.ts'
import { log } from '@clack/prompts'
import { applyKey, editingText, EMPTY_EDITING, formatKeypress } from '@ji.dev/tui'
import { render } from './reply/render.ts'

export interface InputContext {
  screen: Screen
  conversation: Conversation
  answering: Answering
  commands: CommandMenu
  /** Where a reply shows. */
  stage: Stage
  quit: () => void
}

export const MISSING_KEY =
  'DEEPSEEK_API_KEY is not set. Quit with /exit, run `export DEEPSEEK_API_KEY=sk-...`, and start again.'

export class Input {
  private readonly context: InputContext
  private state: Editing = EMPTY_EDITING
  /** The reply in progress, settled once it has written its last line. */
  private replying: Promise<void> = Promise.resolve()

  constructor(context: InputContext) {
    this.context = context
  }

  /** The line as typed so far. */
  get editing(): Editing {
    return this.state
  }

  /** The commands menu, while a command is typed. */
  get menu(): Menu | undefined {
    return this.context.commands.view(this.state)
  }

  /** Resolves once the reply in progress has written its last line. */
  async settled(): Promise<void> {
    await this.replying
  }

  /**
   * The mode, the view and Ctrl+C work everywhere, as scrolling does in the screen; while a question is open, the other
   * keys are its own. Pastes come between markers, so a pasted line break does not send. The screen draws after each.
   */
  readonly onKey = (char: string | undefined, raw: Keypress | undefined): void => {
    const { answering, screen, commands } = this.context
    const key = { ...raw, char }
    const name = formatKeypress(key)

    switch (name) {
      case 'shift+tab':
        answering.switchMode()
        return
      case 'ctrl+o':
        screen.toggle()
        return
      case 'ctrl+c':
        this.interrupt()
        return
    }
    if (answering.open) {
      return
    }

    const menuKey = commands.onKey(name, this.state)
    if (menuKey !== undefined) {
      this.state = menuKey.editing
      if (menuKey.submit) {
        this.submit()
      }
      return
    }
    if (name === 'return' && !this.state.pasting) {
      this.submit()
      return
    }

    this.state = applyKey(this.state, key)
  }

  /** Enter: a command, a new reply, or a steer for the one in progress. */
  private submit(): void {
    const message = editingText(this.state).trim()
    if (message === '') {
      this.clear()
      return
    }
    if (message.startsWith('/')) {
      this.clear()
      // A slash message that is no command goes to the model like any other
      if (!this.context.commands.run(message)) {
        this.send(message)
      }
      return
    }

    void this.submitToModel(message)
  }

  /** A message for the model needs the key; without one it stays in the input, to send once the key is set. */
  private async submitToModel(message: string): Promise<void> {
    if (!(await this.context.conversation.agent.model.hasKey())) {
      log.warn(MISSING_KEY)
      return
    }

    this.clear()
    this.send(message)
  }

  /** Empties the input and lets the screen follow the conversation again. */
  private clear(): void {
    this.state = EMPTY_EDITING
    this.context.screen.follow()
  }

  /** Sends a message, and shows the reply it starts; a steer shows once it reaches the model, as queued until then. */
  send(message: string): void {
    const run = this.context.conversation.send(message)
    if (run !== undefined) {
      this.replying = this.converse(run)
    }
  }

  /** Shows a reply to its end. One that does not finish puts what it was sent back in the input, ahead of what is typed. */
  private async converse(run: Run): Promise<void> {
    const { conversation, screen, stage } = this.context
    const changed = new Set<string>()
    const unfinished = await conversation.follow(run, r => render(r, stage, changed))

    if (unfinished !== undefined) {
      const { sent, stopped, error } = unfinished
      this.state = { ...EMPTY_EDITING, before: [...sent, editingText(this.state)].filter(t => t !== '').join(' ') }

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
  private interrupt(): void {
    const { conversation, quit } = this.context
    if (conversation.replying) {
      conversation.stop()
    } else if (editingText(this.state) !== '') {
      this.state = EMPTY_EDITING
    } else {
      quit()
    }
  }
}
