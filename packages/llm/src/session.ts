import type { Message } from '@mariozechner/pi-ai'
import type { Agent } from './agent.ts'
import type { Run, RunHost } from './run.ts'
import type { AgentState, Boundary, PendingMessage, When } from './types.ts'
import { user } from './message.ts'
import { AgentRun } from './run.ts'

/** 一段对话：保存状态，接收消息 */
export interface Session {
  /**
   * 发送一条消息，返回处理它的运行。字符串会被当作用户消息。
   * agent 正在工作时消息并入当前运行，返回的就是当前的 Run；agent 空闲时开始一次新的运行。
   */
  send: (message: string | Message, options?: { when?: When }) => Run
  /** 最后一次写入的状态，不含进行中的部分输出 */
  readonly state: AgentState
  /** 尚未送达的消息 */
  readonly pending: readonly PendingMessage[]
}

export interface SessionOptions {
  /** 从保存的状态或消息列表继续 */
  state?: AgentState | Message[]
  /** 一次运行最多多少步。插入消息、结束各占一步。默认 64 */
  maxSteps?: number
}

export function createSession(agent: Agent, options: SessionOptions = {}): Session {
  return new AgentSession(agent, options)
}

/* ── 内部 ─────────────────────────────────────────────── */

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
   * 送达规则（RFC-0004 §7.2）：按发送顺序逐条检查，条件成立就送达；
   * 每送达一条，agent 就不再空闲，所以多条 follow-up 会逐条处理
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
