// The conversation: a message starts a reply, or steers the one in progress; a reply that does not finish takes the
// conversation back to before it was sent, and says what it was sent, so nothing typed is lost.

import type { Agent, AgentState, Run, Session, ThinkingLevel } from '@ji.dev/llm'
import { createSession, RunError } from '@ji.dev/llm'
import { requestFastTier } from './fast.ts'

/** How a reply that did not finish ended, for the person to pick up from. */
export interface Unfinished {
  /** Stopped with stop(), rather than by an error. */
  stopped: boolean
  error: unknown
  /** What the reply was sent: its first message, then every steer. */
  sent: string[]
}

/** The run rejects with this when the person stops a reply. */
const STOPPED = new Error('stopped by user')

export class Conversation {
  private current: Agent
  private session: Session
  /** The reply being written, if any: what stop() stops, and what a message sent now steers. */
  private reply: Run | undefined
  /** The state before the reply in progress was sent, to go back to if it does not finish. */
  private before: AgentState | undefined
  private sent: string[] = []
  private fastMode = false

  /** `resume` picks up a conversation kept elsewhere: its id, and its history. */
  constructor(agent: Agent, resume: { id?: string; state?: AgentState } = {}) {
    this.current = agent
    this.session = createSession(agent, resume)
  }

  /** Stays the same when a reply that did not finish takes the conversation back. */
  get id(): string {
    return this.session.id
  }

  get agent(): Agent {
    return this.current
  }

  /** Every model call asks for the priority tier. */
  get fast(): boolean {
    return this.fastMode
  }

  get replying(): boolean {
    return this.reply !== undefined
  }

  /** Nothing has been said yet. */
  get empty(): boolean {
    return this.session.state.messages.length === 0
  }

  /** The steers sent to the reply in progress that have not reached the model yet. */
  get queued(): number {
    return this.reply === undefined ? 0 : this.session.pending.length
  }

  /**
   * A new reply, to follow; undefined when the message steers the reply in progress. 'step' reaches the model at the
   * next step boundary: at once when idle, after the step in progress otherwise.
   */
  send(message: string): Run | undefined {
    const before = this.session.state
    const run = this.session.send(message, { when: 'step' })
    if (run === this.reply) {
      this.sent.push(message)
      return undefined
    }

    this.reply = run
    this.before = before
    this.sent = [message]
    return run
  }

  /** Same conversation, new setting: the next model call uses it, in a reply in progress too. */
  think(level: ThinkingLevel): void {
    this.current = this.current.with({ thinking: level })
    this.session.use(this.current)
  }

  /** Same conversation, faster model calls or back to the standard ones; switched like think. */
  useFastMode(on: boolean): void {
    this.fastMode = on
    this.current = this.current.with({ onPayload: on ? requestFastTier : undefined })
    this.session.use(this.current)
  }

  stop(): void {
    this.reply?.abort(STOPPED)
  }

  /**
   * Waits for a reply as `read` takes it in. One that does not finish takes the conversation back to before it, so the
   * next message does not pick up these unanswered ones.
   */
  async follow(run: Run, read: (run: Run) => Promise<void>): Promise<Unfinished | undefined> {
    try {
      await read(run)
      return undefined
    } catch (error) {
      this.session = createSession(this.current, { id: this.session.id, state: this.before })
      const stopped = error instanceof RunError && error.kind === 'aborted' && error.cause === STOPPED
      return { stopped, error, sent: this.sent }
    } finally {
      this.reply = undefined
    }
  }
}
