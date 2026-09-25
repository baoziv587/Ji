import type { Message } from '@mariozechner/pi-ai'
import type { Agent } from './agent.ts'
import type { Run, RunHost } from './run.ts'
import type { AgentState, Boundary, PendingMessage, When } from './types.ts'
import { user } from './message.ts'
import { AgentRun } from './run.ts'

export interface Session {
  /**
   * Returns the Run that will handle the message; a string becomes a user message.
   * While a Run is in progress the message joins it and that Run is returned; otherwise a new Run starts.
   */
  send: (message: string | Message, options?: { when?: When }) => Run
  /** Last committed state; excludes partial output of the step in progress. */
  readonly state: AgentState
  readonly pending: readonly PendingMessage[]
}

export interface SessionOptions {
  /** Resume from a saved state or message list. */
  state?: AgentState | Message[]
  /** Step limit per Run; inserting messages and finishing each take a step. Default 64. */
  maxSteps?: number
}

export function createSession(agent: Agent, options: SessionOptions = {}): Session {
  return new AgentSession(agent, options)
}

class AgentSession implements Session, RunHost {
  readonly agent: Agent
  readonly maxSteps: number
  state: AgentState

  private queue: PendingMessage[] = []
  private current: AgentRun | undefined

  constructor(agent: Agent, { state = [], maxSteps = 64 }: SessionOptions) {
    this.agent = agent
    this.maxSteps = maxSteps
    this.state = toState(state)
  }

  get pending(): readonly PendingMessage[] {
    return this.queue
  }

  send(message: string | Message, { when = 'idle' }: { when?: When } = {}): Run {
    this.queue.push({ message: typeof message === 'string' ? user(message) : message, when })

    if (this.current !== undefined && !this.current.isFinished) {
      if (when === 'now') {
        this.current.interrupt()
      }
      return this.current
    }

    this.current = new AgentRun(this)
    return this.current
  }

  /**
   * Message queue (RFC-0004 §7.2):
   *
   *   send(msg, { when }) -> queue.push -> Run in progress?  yes: join it ('now' also interrupts it)
   *                                                          no:  start a new Run
   *
   *   offer(boundary), called by the Run at every step boundary; scans the queue in send order:
   *     'idle'          -> delivered if b.idle
   *     'step' | 'now'  -> always delivered
   *     fn              -> delivered if fn(b)
   *     each delivery appends to b.state and sets b.idle = false, so at most one 'idle' message goes per
   *     boundary and queued follow-ups run one at a time (S1)
   *
   *   offer does not dequeue: the Run calls remove() once the step they were offered to completes,
   *   so messages offered to an interrupted or aborted step stay queued.
   */
  offer(boundary: Boundary): PendingMessage[] {
    const delivered: PendingMessage[] = []
    let b = boundary

    for (const pending of this.queue) {
      if (matches(pending.when, b)) {
        delivered.push(pending)
        b = { state: { ...b.state, messages: [...b.state.messages, pending.message] }, idle: false }
      }
    }
    return delivered
  }

  remove(delivered: PendingMessage[]): void {
    this.queue = this.queue.filter(p => !delivered.includes(p))
  }
}

function toState(input: AgentState | Message[]): AgentState {
  return Array.isArray(input) ? { messages: input, plugins: {} } : input
}

function matches(when: When, boundary: Boundary): boolean {
  if (typeof when === 'function') {
    return when(boundary)
  }
  return when === 'idle' ? boundary.idle : true
}
