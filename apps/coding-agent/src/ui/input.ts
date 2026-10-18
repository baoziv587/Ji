// The line typed at the bottom, and what the keys do: Enter sends it to the session as a message, a steer or a
// command, Ctrl+C stops the reply, clears the line or quits, and the rest edit it. The session's replies are drawn from
// here as their events come, whoever sent them: this terminal or the desktop app. One this terminal had a part in that
// does not finish puts what it was sent back in the line.

import type { Editing, Keypress, Screen } from '@ji.dev/tui'
import type { SessionClient } from '../client/session.ts'
import type { LiveEvent, ServiceEvent, ServiceState } from '../server/events.ts'
import type { Answering } from './answering.ts'
import type { Menu } from './bars.ts'
import type { CommandMenu } from './menu.ts'
import type { Stage } from './reply/render.ts'
import { log } from '@clack/prompts'
import { applyKey, editingText, EMPTY_EDITING, formatKeypress } from '@ji.dev/tui'
import { errorMessage } from '@ji.dev/utils'
import { EXIT_COMMAND } from './commands.ts'
import { EventFeed } from './reply/feed.ts'
import { render } from './reply/render.ts'

type ReplyEnd = Extract<ServiceEvent, { type: 'reply_end' }>

export interface InputContext {
  screen: Screen
  session: SessionClient
  /** The session's state now. */
  state: () => ServiceState
  answering: Answering
  commands: CommandMenu
  /** Where a reply shows. */
  stage: Stage
  quit: () => void
}

export class Input {
  private readonly context: InputContext
  private state: Editing = EMPTY_EDITING
  /** The events of the reply being drawn; none between replies. */
  private feed: EventFeed | undefined
  /** The files the reply being drawn changed. */
  private changed = new Set<string>()
  /** This terminal sent the reply in progress, or steered it: what it was sent comes back here if it does not finish. */
  private sentHere = false
  /** Every reply drawn and told the end of, one after the other. */
  private drawing: Promise<void> = Promise.resolve()

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

  /** Resolves once every reply so far has written its last line. */
  async settled(): Promise<void> {
    await this.drawing
  }

  /** Resolves once every run event taken so far is on screen. */
  async drawn(): Promise<void> {
    await this.feed?.drained()
  }

  /** A run event of the session's: the first of a reply starts drawing it. */
  take(e: LiveEvent): void {
    if (this.feed === undefined) {
      const feed = new EventFeed()
      const changed = new Set<string>()
      this.feed = feed
      this.changed = changed
      this.drawing = this.drawing.then(() => render(feed, this.context.stage, changed)).catch(shown)
    }
    this.feed.push(e)
  }

  /** The reply ended: once it is drawn, how it ended, with what it was sent back in the line if it was sent here. */
  ended(e: ReplyEnd): void {
    const changed = this.changed
    const sentHere = this.sentHere
    this.feed?.end()
    this.feed = undefined
    this.sentHere = false
    this.drawing = this.drawing.then(() => this.report(e, changed, sentHere)).catch(shown)
  }

  /** No more events come: the reply being drawn, if any, ends where it is. */
  close(): void {
    this.feed?.end()
    this.feed = undefined
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
    this.clear()
    if (message === EXIT_COMMAND) {
      this.context.quit()
    } else if (message !== '') {
      void this.send(message)
    }
  }

  /**
   * Sends a message or a command to the session; one the session refuses, for want of a key say, goes back in the
   * input, ahead of what is typed. The reply shows as its events come.
   */
  private async send(message: string): Promise<void> {
    const { session, screen } = this.context
    const before = this.sentHere
    const command = message.startsWith('/')
    // Before the answer: a reply can end, and say so, first
    this.sentHere ||= !command
    try {
      const result = command ? await session.command(message) : await session.send(message)
      this.sentHere ||= result !== 'ran'
    } catch (error) {
      this.sentHere = before
      this.putBack([message])
      log.warn(`${errorMessage(error)}\nYour message is back in the input.`)
      screen.draw()
    }
  }

  /** Empties the input and lets the screen follow the conversation again. */
  private clear(): void {
    this.state = EMPTY_EDITING
    this.context.screen.follow()
  }

  /** What was sent goes back in the input, ahead of what is typed. */
  private putBack(sent: string[]): void {
    this.state = { ...EMPTY_EDITING, before: [...sent, editingText(this.state)].filter(t => t !== '').join(' ') }
  }

  /** How a reply that did not finish ended; what it was sent goes back in the input if it was sent from here. */
  private async report({ outcome, error, unsent }: ReplyEnd, changed: Set<string>, sentHere: boolean): Promise<void> {
    const { screen } = this.context
    if (outcome !== 'done') {
      const back = sentHere && unsent !== undefined && unsent !== ''
      if (back) {
        this.putBack([unsent])
      }

      // The history goes back, the files do not: a resend should not take them for untouched
      const stays = changed.size === 1 ? 'stays' : 'stay'
      const kept = changed.size === 0 ? '' : `${[...changed].join(', ')} ${stays} changed. `
      if (outcome === 'stopped') {
        log.warn(`Stopped. ${kept}${back ? 'What you sent is back in the input: edit it or clear it.' : ''}`)
      } else {
        log.error(
          `${error ?? 'The reply failed.'}\n${kept}${back ? 'What you sent is back in the input: press Enter to retry.' : ''}`,
        )
      }
    }
    screen.draw()
  }

  /** Ctrl+C: stops the reply; with none, clears the input; with an empty input, quits. */
  private interrupt(): void {
    const { session, state, quit } = this.context
    if (state().replying) {
      session.stop().catch(shown)
    } else if (editingText(this.state) !== '') {
      this.state = EMPTY_EDITING
    } else {
      quit()
    }
  }
}

/** A failure of the terminal's own, drawing a reply or reaching the session, shown rather than dropped. */
function shown(error: unknown): void {
  log.error(errorMessage(error))
}
