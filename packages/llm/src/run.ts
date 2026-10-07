import type { AssistantMessage, ToolCall, ToolResultMessage } from '@earendil-works/pi-ai/compat'
import type { Agent, RunContext } from './agent.ts'
import type {
  AgentAction,
  AgentState,
  Boundary,
  Payload,
  PendingMessage,
  RunEvent,
  RunInfo,
  RunSummary,
  TurnEvent,
  TurnTiming,
  UsageTotals,
} from './types.ts'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { MaxStepsError, unfold } from '@ji.dev/kernel'
import { resultOf } from '@ji.dev/kernel/reduce'
import { deepFreeze } from '@ji.dev/utils'
import { checks, instantiate, observe } from './agent.ts'
import { ModelCallError, RunError } from './errors.ts'
import { isIdle } from './message.ts'
import { addUsage, NO_USAGE, summaryReducer } from './summary.ts'
import { turnOf } from './turn.ts'

/**
 * Lasts until the agent is idle and no queued message can be inserted.
 * All members share one run; leaving any `for await` early cancels the whole run (I7).
 */
export interface Run extends AsyncIterable<RunEvent> {
  /** Text deltas produced after reading starts; earlier ones are not replayed. */
  readonly text: AsyncIterable<string>
  /** One record per step; always replays from the first step, whenever reading starts. */
  readonly turns: AsyncIterable<TurnEvent>
  /** Rejects with a RunError if the run is aborted or fails. */
  readonly summary: Promise<RunSummary>
  readonly result: Promise<AssistantMessage>
  readonly state: Promise<AgentState>
  /** Undelivered messages stay queued in the session. */
  abort: (reason?: unknown) => void
}

/** What a Run needs from its Session. */
export interface RunHost {
  /** The session's agent; session.use may change it, and the Run switches at the next step boundary. */
  readonly agent: Agent
  /** Session id, reported to observers. */
  readonly id: string
  readonly maxSteps: number
  /** Last committed state; the Run updates it after every step. */
  state: AgentState
  /** Does not dequeue; see remove. */
  offer: (boundary: Boundary) => PendingMessage[]
  remove: (delivered: PendingMessage[]) => void
}

type Stopping = { kind: 'interrupt' } | { kind: 'abort'; reason: unknown }
type RunEnd = Extract<Payload, { type: 'run_end' }>

export class AgentRun implements Run {
  readonly summary: Promise<RunSummary>
  readonly result: Promise<AssistantMessage>
  readonly state: Promise<AgentState>

  private readonly host: RunHost
  private readonly info: RunInfo
  /** Fixed for the whole run, so every observer sees a run from its first event to its last. */
  private readonly observe: (e: RunEvent, run: RunInfo) => void
  private readonly log: TurnEvent[] = []
  private readonly subscribers = new Set<RunEvent[]>()
  /** result, state and summary are all read off this one settlement. */
  private readonly outcome = Promise.withResolvers<{
    result: AssistantMessage
    state: AgentState
    summary: RunSummary
  }>()

  private changed = Promise.withResolvers<void>()
  /** Set once run_end goes out; the run is finished from then on. */
  private end: RunEnd | undefined

  private acc = summaryReducer.init
  /** Folded from model_end and model_error as they are published, so no later step outcome can take it back. */
  private usage: UsageTotals = NO_USAGE
  private steps = 0
  /** The step in progress, folded from the payloads it has published so far. */
  private step = openStep(performance.now())
  /** Offered to the step in flight; dequeued only once that step is committed. */
  private offered: PendingMessage[] = []
  private interruptedBoundary = false
  private stopping: Stopping | undefined
  private controller = new AbortController()
  private stopSegment: () => void = noop

  constructor(host: RunHost) {
    this.host = host
    this.info = { id: randomUUID(), session: host.id }
    this.observe = host.agent[observe]
    if (host.agent[checks]) {
      deepFreeze(host.state)
    }

    this.result = this.outcome.promise.then(o => o.result)
    this.state = this.outcome.promise.then(o => o.state)
    this.summary = this.outcome.promise.then(o => o.summary)
    // Nobody may await these; attach handlers up front so a failure is not an unhandled rejection.
    for (const promise of [this.result, this.state, this.summary]) {
      promise.catch(noop)
    }

    void this.drive()
  }

  get isFinished(): boolean {
    return this.end !== undefined
  }

  get text(): AsyncIterable<string> {
    return this.readText()
  }

  get turns(): AsyncIterable<TurnEvent> {
    return this.readTurns()
  }

  [Symbol.asyncIterator](): AsyncIterator<RunEvent> {
    return this.readEvents()
  }

  abort(reason?: unknown): void {
    if (!this.end) {
      this.stop({ kind: 'abort', reason })
    }
  }

  /** Cancels the step in flight, drops anything uncommitted, and continues from the last committed state. */
  interrupt(): void {
    if (!this.end && !this.stopping) {
      this.stop({ kind: 'interrupt' })
    }
  }

  private stop(stopping: Stopping): void {
    this.stopping = stopping
    this.controller.abort(stopping.kind === 'abort' ? stopping.reason : undefined)
    this.stopSegment()
  }

  /**
   * A Run is a chain of segments, each one kernel unfold started from the last committed state:
   *
   *   drive
   *     +-> runSegment: unfold(agent[instantiate](ctx), host.state, maxSteps - steps)
   *     |     delta  -> publish the payload (step_start first if the step has not started)
   *     |     act    -> dequeue offered, commit (host.state, log, summary acc, steps++), publish step_end
   *     |     done   -> dequeue offered, return { result }
   *     |     interrupt() / abort() -> 'stopped': the step in flight is dropped uncommitted
   *     |     session.use(agent) -> 'switched' after the commit: the next segment uses the new agent
   *     |
   *     +-- 'stopped' by interrupt -> step_cancelled; the next boundary reports interrupted: true
   *     +-- 'switched'
   *     +-- done, but a queued message has become deliverable
   *
   *   'stopped' by abort, or a throw -> step_cancelled if a step was open, run_end failed
   *   done otherwise                 -> run_end done
   *
   * steps, t and the summary carry across segments, so the whole Run shares one maxSteps budget.
   */
  private async drive(): Promise<void> {
    try {
      for (;;) {
        const outcome = await this.runSegment()

        if (outcome === 'switched') {
          continue
        }
        if (outcome === 'stopped') {
          if (this.stopping?.kind === 'abort') {
            throw this.stopping.reason
          }
          this.cancelStep('interrupt')
          this.stopping = undefined
          this.interruptedBoundary = true
          continue
        }

        // A message that became deliverable after the last boundary belongs to this Run, not a new one.
        const state = this.host.state
        if (this.host.offer({ state, idle: isIdle(state) }).length > 0) {
          continue
        }

        this.settle({ type: 'run_end', outcome: 'done', result: outcome.result, summary: this.summarySoFar })
        return
      }
    } catch (cause) {
      const kind = this.stopping?.kind === 'abort' ? 'aborted' : kindOf(cause)
      const error = new RunError(kind, { t: this.steps, state: this.host.state, cause })

      this.cancelStep(kind === 'aborted' ? 'abort' : 'error')
      this.settle({ type: 'run_end', outcome: 'failed', error, summary: this.summarySoFar })
    }
  }

  private async runSegment(): Promise<'stopped' | 'switched' | { result: AssistantMessage }> {
    if (this.stopping) {
      return 'stopped'
    }

    const controller = new AbortController()
    this.controller = controller

    const agent = this.host.agent
    const ctx: RunContext = {
      signal: controller.signal,
      offer: boundary => {
        this.offered = this.host.offer(boundary)
        return this.offered.map(p => p.message)
      },
      interrupted: () => this.interruptedBoundary,
    }

    const events = unfold(agent[instantiate](ctx), this.host.state, this.host.maxSteps - this.steps)
    // A step that has published nothing yet starts its clock here; one that has keeps going under its step_start.
    if (!this.step.started) {
      this.step = openStep(performance.now())
    }

    try {
      for (;;) {
        const next = await this.nextUnlessStopped(events)
        if (next === 'stopped') {
          return 'stopped'
        }
        if (next.done) {
          throw new Error('unfold ended without a done event')
        }

        const e = next.value
        if (e.tag === 'delta') {
          this.publishInStep(e.delta)
          continue
        }

        this.host.remove(this.offered)
        this.offered = []

        if (e.tag === 'done') {
          return { result: e.result }
        }
        this.commit(e.action, e.obs, e.state)

        if (this.host.agent !== agent) {
          return 'switched'
        }
      }
    } finally {
      // unfold may still be inside a tool or model call; don't wait for it, it ends once the signal aborts.
      events.return(undefined).catch(noop)
    }
  }

  /**
   * The next event, or 'stopped' if interrupt() / abort() comes first; when both land together, the stop wins.
   * Each call waits on its own promise: racing one promise that lives for the whole segment would pile a reaction per
   * event onto it and keep every event alive until the segment ends.
   */
  private nextUnlessStopped<T>(events: AsyncIterator<T>): Promise<IteratorResult<T> | 'stopped'> {
    if (this.stopping) {
      return Promise.resolve('stopped')
    }

    const pending = events.next()
    return new Promise((resolve, reject) => {
      this.stopSegment = () => resolve('stopped')
      pending.then(resolve, reject)
    })
  }

  private commit(action: AgentAction, results: ToolResultMessage[], state: AgentState): void {
    const now = performance.now()
    const turn = turnOf(action, results)
    const timing = timingOf(this.step, now, turn.kind === 'model')

    this.host.state = this.host.agent[checks] ? deepFreeze(state) : state
    this.acc = summaryReducer.reduce(this.acc, { turn, timing })
    const record: TurnEvent = { t: this.steps, turn, state, timing, summary: this.summarySoFar }
    this.log.push(record)
    this.publishInStep({ ...record, type: 'step_end' })

    this.step = openStep(now)
    this.steps++
    this.interruptedBoundary = false
  }

  /** Closes a step that was dropped uncommitted; nothing to close if it had not published anything. */
  private cancelStep(reason: 'interrupt' | 'abort' | 'error'): void {
    if (this.step.started) {
      this.publish({ type: 'step_cancelled', reason, open: [...this.step.open.values()] })
    }
    this.step = openStep(performance.now())
  }

  /** result, state and summary are projections of run_end (RFC-0005 §3.6), so they settle from it. */
  private settle(end: RunEnd): void {
    this.end = end
    this.publish(end)

    if (end.outcome === 'done') {
      this.outcome.resolve({ result: end.result, state: this.host.state, summary: end.summary })
    } else {
      this.outcome.reject(end.error)
    }
  }

  private get summarySoFar(): RunSummary {
    return { ...resultOf(summaryReducer, this.acc), usage: this.usage }
  }

  /*
   *   deltas, step_end --publishInStep--> fold into this.step and usage, then publish
   *   every event --------publish-------> observe (every plugin, isolated)
   *                                    +-> a buffer per live reader --> for await (run), run.text
   *   commit ---------------------------> log[] --> run.turns (replays from log[0])
   *   run_end ------------settle--------> result, state, summary
   */

  /** Every event of a step comes after its step_start; a step that ends with no event at all has none. */
  private publishInStep(payload: Payload): void {
    if (!this.step.started) {
      this.publish({ type: 'step_start' })
    }
    this.step = scanStep(this.step, payload, performance.now())
    this.usage = scanUsage(this.usage, payload)
    this.publish(payload)
  }

  private publish(payload: Payload): void {
    const e = { ...payload, t: this.steps } as RunEvent
    this.observe(e, this.info)
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

  private async *readEvents(): AsyncGenerator<RunEvent, void> {
    const buffer: RunEvent[] = []
    this.subscribers.add(buffer)

    try {
      yield* this.follow(() => buffer.shift())
    } finally {
      this.subscribers.delete(buffer)
    }
  }

  private async *readText(): AsyncGenerator<string, void> {
    for await (const e of this.readEvents()) {
      if (e.type === 'text') {
        yield e.delta
      }
    }
  }

  private readTurns(): AsyncGenerator<TurnEvent, void> {
    let i = 0
    return this.follow(() => (i < this.log.length ? this.log[i++] : undefined))
  }

  /** Yields what take() has, waits while it has nothing, and ends with the run; leaving early aborts the run (I7). */
  private async *follow<T>(take: () => T | undefined): AsyncGenerator<T, void> {
    try {
      for (;;) {
        const next = take()
        if (next !== undefined) {
          yield next
          continue
        }
        if (this.end?.outcome === 'failed') {
          throw this.end.error
        }
        if (this.end) {
          return
        }

        await this.changed.promise
      }
    } finally {
      this.abort()
    }
  }
}

function kindOf(cause: unknown): RunError['kind'] {
  if (cause instanceof MaxStepsError) {
    return 'max_steps'
  }
  return cause instanceof ModelCallError ? 'provider' : 'internal'
}

/**
 * What a step's own events say about it: whether step_start has gone out, which calls are still running, and when the
 * timing marks fell. It is a pure fold over the step's payloads; the clock reading comes in with each one.
 *
 * Timing is observation only and never affects behavior, so it lives here rather than in state. It reads the same
 * events everyone else sees: no side channel measures anything.
 */
interface OpenStep {
  readonly at: number
  readonly started: boolean
  /** Calls with a tool_start but no tool_end yet. */
  readonly open: ReadonlyMap<string, ToolCall>
  readonly firstToken?: number
  readonly modelEnd?: number
  readonly toolMs: Readonly<Record<string, number>>
}

function openStep(at: number): OpenStep {
  return { at, started: false, open: new Map(), toolMs: {} }
}

/** Returns step itself when nothing changes, so the hot path (text and thinking deltas) allocates nothing. */
function scanStep(step: OpenStep, payload: Payload, at: number): OpenStep {
  const s = step.started ? step : { ...step, started: true }

  switch (payload.type) {
    case 'thinking':
    case 'text':
    case 'tool_call_delta':
    case 'tool_call':
      return s.firstToken === undefined ? { ...s, firstToken: at } : s
    case 'model_end':
      // A plugin's ctx.complete does not count toward the main model's time
      return payload.by === undefined ? { ...s, modelEnd: at } : s
    case 'tool_start':
      return { ...s, open: new Map(s.open).set(payload.call.id, payload.call) }
    case 'tool_end': {
      const open = new Map(s.open)
      open.delete(payload.call.id)
      return { ...s, open, toolMs: { ...s.toolMs, [payload.call.id]: payload.ms } }
    }
    default:
      return s
  }
}

/** r.summary.usage is a fold over the model events (RFC-0006 §5.5): every attempt that reported usage counts once. */
function scanUsage(total: UsageTotals, payload: Payload): UsageTotals {
  if (payload.type === 'model_end') {
    return addUsage(total, payload.message.usage)
  }
  if (payload.type === 'model_error' && payload.usage !== undefined) {
    return addUsage(total, payload.usage)
  }
  return total
}

function timingOf(step: OpenStep, at: number, model: boolean): TurnTiming {
  const timing: TurnTiming = { ms: at - step.at }

  if (model) {
    timing.modelMs = (step.modelEnd ?? at) - step.at
    timing.toolMs = { ...step.toolMs }
    if (step.firstToken !== undefined) {
      timing.firstTokenMs = step.firstToken - step.at
    }
  }
  return timing
}

function noop(): void {}
