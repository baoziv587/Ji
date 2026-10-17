// The conversation: a message starts a reply, or steers the one in progress; a reply that does not finish takes the
// conversation back to before it was sent, and says what it was sent, so nothing typed is lost. A conversation the
// terminal and the service share takes a lock for each reply, and goes on from what the other wrote before it.

import type { Agent, AgentState, Run, Session, ThinkingLevel } from '@ji.dev/llm'
import { createSession, RunError } from '@ji.dev/llm'
import { requestFastTier, supportsFastMode } from './fast.ts'

/** How a reply that did not finish ended, for the person to pick up from. */
export interface Unfinished {
  /** Stopped with stop(), rather than by an error. */
  stopped: boolean
  error: unknown
  /** What the reply was sent: its first message, then every steer. */
  sent: string[]
}

/** What a reply the person stopped ends with: a log has the message, read back as a stop (server/events.ts). */
export const STOPPED_MESSAGE = 'stopped by user'

/** The run rejects with this when the person stops a reply. */
const STOPPED = new Error(STOPPED_MESSAGE)

/** A conversation kept where another process can write to it too: one reply at a time, from either. */
export interface ReplyLock {
  /**
   * Takes the conversation for a reply: the history to go on from when the other process wrote to it since, none when
   * this one has it all. Throws SessionBusyError while the other writes a reply.
   */
  claim: () => AgentState | undefined
  release: () => void
}

/** Who writes a reply to a shared conversation: the terminal, or the service a window talks to. */
export type Writer = 'terminal' | 'desktop'

const WRITER_NAMES: Record<Writer, string> = { terminal: 'The terminal', desktop: 'The desktop app' }

/** Another process writes a reply to the conversation: `by` says which. */
export class SessionBusyError extends Error {
  readonly by: Writer

  constructor(by: Writer) {
    super(`${WRITER_NAMES[by]} is replying in this session.`)
    this.name = 'SessionBusyError'
    this.by = by
  }
}

export class Conversation {
  private current: Agent
  private session: Session
  /** The reply being written, if any: what stop() stops, and what a message sent now steers. */
  private reply: Run | undefined
  /** The state before the reply in progress was sent, to go back to if it does not finish. */
  private before: AgentState | undefined
  private sent: string[] = []
  private fastMode = false
  private readonly lock: ReplyLock | undefined

  /** `resume` picks up a conversation kept elsewhere: its id, and its history. */
  constructor(agent: Agent, resume: { id?: string; state?: AgentState } = {}, lock?: ReplyLock) {
    this.current = agent
    this.session = createSession(agent, resume)
    this.lock = lock
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
    const starting = this.reply === undefined
    let before: AgentState
    let run: Run
    try {
      const newer = starting ? this.lock?.claim() : undefined
      if (newer !== undefined) {
        this.resume(newer)
      }
      before = this.session.state
      run = this.session.send(message, { when: 'step' })
    } catch (error) {
      // The lock is only given back by the process that has it: a refused claim leaves the other's as it is
      if (starting) {
        this.lock?.release()
      }
      throw error
    }
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

  /**
   * Same conversation, another agent: one on another model, say. Fast mode stays on where the new model has the tier.
   * Throws while a reply is in progress: its steps so far went to the model it started with.
   */
  use(agent: Agent): void {
    if (this.reply !== undefined) {
      throw new Error('Stop the reply before switching models.')
    }

    this.fastMode &&= supportsFastMode(agent.model)
    this.current = this.fastMode ? agent.with({ onPayload: requestFastTier }) : agent
    this.session.use(this.current)
  }

  /** Same conversation, the history another process took it on to. Throws while a reply is in progress. */
  resume(state: AgentState): void {
    if (this.reply !== undefined) {
      throw new Error('Stop the reply before taking up another history.')
    }
    this.session = createSession(this.current, { id: this.session.id, state })
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
      this.lock?.release()
    }
  }
}
