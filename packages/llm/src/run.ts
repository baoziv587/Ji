import type { AssistantMessage, AssistantMessageEvent, ToolResultMessage } from '@mariozechner/pi-ai'
import type { Agent, RunContext } from './agent.ts'
import type { AgentAction, AgentEvent, AgentState, Boundary, PendingMessage, RunSummary, TurnEvent, TurnTiming } from './types.ts'
import { performance } from 'node:perf_hooks'
import { unfold } from '@gaoxiang.ai/kernel'
import { resultOf } from '@gaoxiang.ai/kernel/reduce'
import { instantiate } from './agent.ts'
import { isIdle } from './message.ts'
import { summaryReducer } from './summary.ts'
import { turnOf } from './turn.ts'

/**
 * 一次运行：从开始到 agent 空闲且没有可插入的消息。
 * 各成员共享这一次运行；提前退出任何 for await 都会取消整次运行（I7）。
 */
export interface Run extends AsyncIterable<AgentEvent> {
  /** 模型输出的文字增量，只包含开始读取之后的部分 */
  readonly text: AsyncIterable<string>
  /** 每一步一条记录；无论何时开始读，都从第一步开始 */
  readonly turns: AsyncIterable<TurnEvent>
  /** 这次运行的统计。运行被取消或出错时 reject */
  readonly summary: Promise<RunSummary>
  /** 最终回答 */
  readonly result: Promise<AssistantMessage>
  /** 最终状态，可保存 */
  readonly state: Promise<AgentState>
  /** 取消运行。尚未送达的消息留在会话里 */
  abort: (reason?: unknown) => void
}

/** 内部：Run 与所属会话之间的接口 */
export interface RunHost {
  readonly agent: Agent
  readonly maxSteps: number
  /** 最后写入的状态。Run 每写入一步就更新它 */
  state: AgentState
  /** 这个步边界上可以送达的消息，不从队列中移除 */
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
  /** 当前这一步取出、写入后才从队列移除的消息 */
  private offered: PendingMessage[] = []
  private interruptedBoundary = false
  private stopping: { kind: 'interrupt' } | { kind: 'abort', reason: unknown } | undefined
  private controller = new AbortController()
  private stopSegment: () => void = () => {}

  constructor(host: RunHost) {
    this.host = host

    // 这三个 Promise 可能没有人等待；预先挂上处理函数，避免未处理的 rejection
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

  /** 取消当前这一步，丢弃未写入的内容，从最后写入的状态继续 */
  interrupt(): void {
    if (this.finished || this.stopping) {
      return
    }

    this.stopping = { kind: 'interrupt' }
    this.controller.abort()
    this.stopSegment()
  }

  /* ── 驱动 ─────────────────────────────────────────── */

  /** 一次运行由若干段 unfold 组成：每次中断结束一段，从最后写入的状态开始下一段 */
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

        // 结束前再看一次：运行结束前到达的消息由同一次运行处理
        const state = this.host.state
        if (this.host.offer({ state, idle: isIdle(state) }).length > 0) {
          continue
        }

        this.finish(outcome.result)
        return
      }
    }
    catch (error) {
      this.fail(error)
    }
  }

  private async runSegment(): Promise<'stopped' | { result: AssistantMessage }> {
    if (this.stopping) {
      return 'stopped'
    }

    const controller = new AbortController()
    const stopped = new Promise<'stopped'>((resolve) => {
      this.stopSegment = () => resolve('stopped')
    })
    this.controller = controller

    const isCurrent = (): boolean => this.controller === controller
    const ctx: RunContext = {
      signal: controller.signal,
      offer: (boundary) => {
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

        // stopped 放在前面：中断与一步的完成同时发生时，中断优先，这一步被丢弃
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
    }
    finally {
      // 被中断时 unfold 可能还停在工具或模型调用上；不等待它，让它在 signal 中止后自行结束
      events.return(undefined).catch(noop)
    }
  }

  private commit(action: AgentAction, results: ToolResultMessage[], state: AgentState): void {
    const turn = turnOf(action, results)
    const timing = this.clock.lap(turn.kind === 'model')

    this.host.state = state
    this.acc = summaryReducer.reduce(this.acc, { turn, timing })
    this.log.push({ t: this.steps, turn, state, timing, summary: resultOf(summaryReducer, this.acc) })

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

  /* ── 读取 ─────────────────────────────────────────── */

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

  private async* readEvents(): AsyncGenerator<AgentEvent, void> {
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
    }
    finally {
      this.subscribers.delete(buffer)
      this.abortIfRunning()
    }
  }

  private async* readText(): AsyncGenerator<string, void> {
    for await (const e of this.readEvents()) {
      if (e.tag === 'delta' && e.delta.type === 'text_delta') {
        yield e.delta.delta
      }
    }
  }

  private async* readTurns(): AsyncGenerator<TurnEvent, void> {
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
    }
    finally {
      this.abortIfRunning()
    }
  }

  /** 读者提前退出（break 或抛出异常）时取消运行 */
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

/* ── 内部 ─────────────────────────────────────────────── */

/** 测量一步的耗时。只是观察，不影响行为，所以不进入状态 */
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

  /** 结束这一步，返回它的耗时，并开始计下一步 */
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
