import type { AssistantMessage, AssistantMessageEvent, ToolResultMessage } from '@mariozechner/pi-ai'
import type { Agent, RunContext } from './agent.ts'
import type {
  AgentAction,
  AgentEvent,
  AgentState,
  Boundary,
  PendingMessage,
  RunSummary,
  TurnEvent,
  TurnTiming,
} from './types.ts'
import { performance } from 'node:perf_hooks'
import { unfold } from '@gaoxiang.ai/kernel'
import { resultOf } from '@gaoxiang.ai/kernel/reduce'
import { instantiate } from './agent.ts'
import { isIdle } from './message.ts'
import { summaryReducer } from './summary.ts'
import { turnOf } from './turn.ts'

/**
 * Lasts until the agent is idle and no queued message can be inserted.
 * All members share one run; leaving any `for await` early cancels the whole run (I7).
 */
export interface Run extends AsyncIterable<AgentEvent> {
  /** Text deltas produced after reading starts; earlier ones are not replayed. */
  readonly text: AsyncIterable<string>
  /** One record per step; always replays from the first step, whenever reading starts. */
  readonly turns: AsyncIterable<TurnEvent>
  /** Rejects if the run is aborted or fails. */
  readonly summary: Promise<RunSummary>
  readonly result: Promise<AssistantMessage>
  readonly state: Promise<AgentState>
  /** Undelivered messages stay queued in the session. */
  abort: (reason?: unknown) => void
}

/** What a Run needs from its Session. */
export interface RunHost {
  readonly agent: Agent
  readonly maxSteps: number
  /** Last committed state; the Run updates it after every step. */
  state: AgentState
  /** Does not dequeue; see remove. */
  offer: (boundary: Boundary) => PendingMessage[]
  remove: (delivered: PendingMessage[]) => void
}

export class AgentRun implements Run {
  readonly summary: Promise<RunSummary>
  readonly result: Promise<AssistantMessage>
  readonly state: Promise<AgentState>

  private readonly host: RunHost
  private readonly log: TurnEvent[] = []
  private readonly subscribers = new Set<AgentEvent[]>()
  private readonly clock = new StepClock()
  private readonly outcome = {
    summary: Promise.withResolvers<RunSummary>(),
    result: Promise.withResolvers<AssistantMessage>(),
    state: Promise.withResolvers<AgentState>(),
  }

  private changed = Promise.withResolvers<void>()
  private finished = false
  private failure: { error: unknown } | undefined

  private acc = summaryReducer.init
  private steps = 0
  /** Offered to the step in flight; dequeued only once that step is committed. */
  private offered: PendingMessage[] = []
  private interruptedBoundary = false
  private stopping: { kind: 'interrupt' } | { kind: 'abort'; reason: unknown } | undefined
  private controller = new AbortController()
  private stopSegment: () => void = () => {}

  constructor(host: RunHost) {
    this.host = host

    // Nobody may await these; attach handlers up front so a failure is not an unhandled rejection.
    for (const { promise } of Object.values(this.outcome)) {
      promise.catch(noop)
    }
    this.summary = this.outcome.summary.promise
    this.result = this.outcome.result.promise
    this.state = this.outcome.state.promise

    void this.drive()
  }

  get isFinished(): boolean {
    return this.finished
  }

  get text(): AsyncIterable<string> {
    return this.readText()
  }

  get turns(): AsyncIterable<TurnEvent> {
    return this.readTurns()
  }

  [Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
    return this.readEvents()
  }

  abort(reason: unknown = new Error('run aborted')): void {
    if (this.finished) {
      return
    }

    this.stopping = { kind: 'abort', reason }
    this.controller.abort(reason)
    this.stopSegment()
  }

  /** Cancels the step in flight, drops anything uncommitted, and continues from the last committed state. */
  interrupt(): void {
    if (this.finished || this.stopping) {
      return
    }

    this.stopping = { kind: 'interrupt' }
    this.controller.abort()
    this.stopSegment()
  }

  /**
   * A Run is a chain of segments, each one kernel unfold started from the last committed state:
   *
   *   drive
   *     +-> runSegment: unfold(agent[instantiate](ctx), host.state, maxSteps - steps)
   *     |     delta  -> publish
   *     |     act    -> publish, dequeue offered, commit (host.state, log, summary acc, steps++)
   *     |     done   -> publish, dequeue offered, return { result }
   *     |     interrupt() / abort() -> 'stopped': the step in flight is dropped uncommitted
   *     |
   *     +-- 'stopped' by interrupt -> the next boundary reports interrupted: true
   *     +-- done, but a queued message has become deliverable
   *
   *   'stopped' by abort -> fail(reason)          done otherwise -> finish(result)
   *
   * steps, t and the summary carry across segments, so the whole Run shares one maxSteps budget.
   */
  private async drive(): Promise<void> {
    try {
      for (;;) {
        const outcome = await this.runSegment()

        if (outcome === 'stopped') {
          if (this.stopping?.kind === 'abort') {
            throw this.stopping.reason
          }
          this.stopping = undefined
          this.interruptedBoundary = true
          continue
        }

        // A message that became deliverable after the last boundary belongs to this Run, not a new one.
        const state = this.host.state
        if (this.host.offer({ state, idle: isIdle(state) }).length > 0) {
          continue
        }

        this.finish(outcome.result)
        return
      }
    } catch (error) {
      this.fail(error)
    }
  }

  private async runSegment(): Promise<'stopped' | { result: AssistantMessage }> {
    if (this.stopping) {
      return 'stopped'
    }

    const controller = new AbortController()
    const stopped = new Promise<'stopped'>(resolve => {
      this.stopSegment = () => resolve('stopped')
    })
    this.controller = controller

    const isCurrent = (): boolean => this.controller === controller
    const ctx: RunContext = {
      signal: controller.signal,
      offer: boundary => {
        this.offered = this.host.offer(boundary)
        return this.offered.map(p => p.message)
      },
      interrupted: () => this.interruptedBoundary,
      toolTime: (id, ms) => {
        if (isCurrent()) {
          this.clock.tool(id, ms)
        }
      },
    }

    const events = unfold(this.host.agent[instantiate](ctx), this.host.state, this.host.maxSteps - this.steps)
    this.clock.begin()

    try {
      for (;;) {
        const pending = events.next()
        pending.catch(noop)

        // `stopped` goes first: when an interrupt and a step completion coincide, the interrupt wins.
        const next = await Promise.race([stopped, pending])
        if (next === 'stopped') {
          return 'stopped'
        }
        if (next.done) {
          throw new Error('unfold ended without a done event')
        }

        const e = { ...next.value, t: this.steps }
        this.publish(e)

        if (e.tag === 'delta') {
          this.clock.delta(e.delta)
          continue
        }

        this.host.remove(this.offered)
        this.offered = []

        if (e.tag === 'done') {
          return { result: e.result }
        }
        this.commit(e.action, e.obs, e.state)
      }
    } finally {
      // unfold may still be inside a tool or model call; don't wait for it, it ends once the signal aborts.
      events.return(undefined).catch(noop)
    }
  }

  private commit(action: AgentAction, results: ToolResultMessage[], state: AgentState): void {
    const turn = turnOf(action, results)
    const timing = this.clock.lap(turn.kind === 'model')

    this.host.state = state
    this.acc = summaryReducer.reduce(this.acc, { turn, timing })
    this.log.push({
      t: this.steps,
      turn,
      state,
      timing,
      summary: resultOf(summaryReducer, this.acc),
    })

    this.steps++
    this.interruptedBoundary = false
    this.notify()
  }

  private finish(result: AssistantMessage): void {
    this.finished = true
    this.outcome.result.resolve(result)
    this.outcome.state.resolve(this.host.state)
    this.outcome.summary.resolve(resultOf(summaryReducer, this.acc))
    this.notify()
  }

  private fail(error: unknown): void {
    this.finished = true
    this.failure = { error }
    for (const { reject } of Object.values(this.outcome)) {
      reject(error)
    }
    this.notify()
  }

  /*
   *   unfold events --publish--> one buffer per live reader --> for await (run), run.text
   *                                                             (only events after subscribing)
   *   commit -------------------> log[] ----------------------> run.turns (replays from log[0])
   *   finish / fail ------------> result, state, summary promises
   *
   * notify() replaces `changed`, waking every waiting reader. A reader that exits early aborts the run.
   */
  private publish(e: AgentEvent): void {
    for (const buffer of this.subscribers) {
      buffer.push(e)
    }
    this.notify()
  }

  private notify(): void {
    const changed = this.changed
    this.changed = Promise.withResolvers<void>()
    changed.resolve()
  }

  private async *readEvents(): AsyncGenerator<AgentEvent, void> {
    const buffer: AgentEvent[] = []
    this.subscribers.add(buffer)

    try {
      for (;;) {
        const next = buffer.shift()
        if (next !== undefined) {
          yield next
          continue
        }
        if (this.finished) {
          this.throwIfFailed()
          return
        }

        await this.changed.promise
      }
    } finally {
      this.subscribers.delete(buffer)
      this.abortIfRunning()
    }
  }

  private async *readText(): AsyncGenerator<string, void> {
    for await (const e of this.readEvents()) {
      if (e.tag === 'delta' && e.delta.type === 'text_delta') {
        yield e.delta.delta
      }
    }
  }

  private async *readTurns(): AsyncGenerator<TurnEvent, void> {
    let i = 0

    try {
      for (;;) {
        if (i < this.log.length) {
          yield this.log[i++]
          continue
        }
        if (this.finished) {
          this.throwIfFailed()
          return
        }

        await this.changed.promise
      }
    } finally {
      this.abortIfRunning()
    }
  }

  private abortIfRunning(): void {
    if (!this.finished) {
      this.abort()
    }
  }

  private throwIfFailed(): void {
    if (this.failure) {
      throw this.failure.error
    }
  }
}

/** Timing is observation only and never affects behavior, so it lives here rather than in state. */
class StepClock {
  private start = 0
  private firstToken: number | undefined
  private lastDelta: number | undefined
  private tools: Record<string, number> = {}

  begin(): void {
    this.start = performance.now()
    this.firstToken = undefined
    this.lastDelta = undefined
    this.tools = {}
  }

  delta(delta: AssistantMessageEvent): void {
    const now = performance.now()
    if (delta.type.endsWith('_delta')) {
      this.firstToken ??= now
    }
    this.lastDelta = now
  }

  tool(id: string, ms: number): void {
    this.tools[id] = ms
  }

  /** Also restarts the clock for the next step. */
  lap(model: boolean): TurnTiming {
    const now = performance.now()
    const timing: TurnTiming = { ms: now - this.start }

    if (model) {
      timing.modelMs = (this.lastDelta ?? now) - this.start
      timing.toolMs = this.tools
      if (this.firstToken !== undefined) {
        timing.firstTokenMs = this.firstToken - this.start
      }
    }

    this.begin()
    return timing
  }
}

function noop(): void {}
