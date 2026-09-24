import type { Reducer } from '@ji/kernel/reduce'
import type { Usage } from '@mariozechner/pi-ai'
import type { AgentState, RunSummary, Turn, TurnTiming, UsageTotals } from './types.ts'
import { combine } from '@ji/kernel/reduce'

/** 在 summaryReducer 初始化时就要用到，所以放在最前面 */
const NO_USAGE: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }

/** state.messages 中所有助手消息的用量之和。压缩后被替换的消息不再计入 */
export function usageOf(state: AgentState): UsageTotals {
  return state.messages.reduce((total, m) => (m.role === 'assistant' ? addUsage(total, m.usage) : total), NO_USAGE)
}

/* ── 供 Run 使用：Run.summary 是下面这个 reducer 对每一步的归约 ─── */

export interface TimedTurn {
  turn: Turn
  timing: TurnTiming
}

export const summaryReducer: Reducer<TimedTurn, RunSummary> = combine({
  turns: counter(({ turn }) => (turn.kind === 'model' ? 1 : 0)),
  usage: { init: NO_USAGE, reduce: addTurnUsage },
  modelMs: counter(({ timing }) => timing.modelMs ?? 0),
  toolMs: counter(({ timing }) => Object.values(timing.toolMs ?? {}).reduce((a, b) => a + b, 0)),
  tools: { init: {} as RunSummary['tools'], reduce: addToolStats },
  inputs: counter(({ turn }) => (turn.kind === 'input' ? turn.messages.length : 0)),
  rewrites: counter(({ turn }) => (turn.kind === 'rewrite' ? 1 : 0)),
})

/* ── 内部 ─────────────────────────────────────────────── */

function addUsage(total: UsageTotals, usage: Usage): UsageTotals {
  return {
    input: total.input + usage.input,
    output: total.output + usage.output,
    cacheRead: total.cacheRead + usage.cacheRead,
    cacheWrite: total.cacheWrite + usage.cacheWrite,
    cost: total.cost + usage.cost.total,
  }
}

function addTurnUsage(total: UsageTotals, { turn }: TimedTurn): UsageTotals {
  return turn.kind === 'model' ? addUsage(total, turn.message.usage) : total
}

function counter(amount: (x: TimedTurn) => number): Reducer<TimedTurn, number> {
  return { init: 0, reduce: (n, x) => n + amount(x) }
}

function addToolStats(stats: RunSummary['tools'], { turn, timing }: TimedTurn): RunSummary['tools'] {
  if (turn.kind !== 'model') {
    return stats
  }

  const next = { ...stats }
  for (const result of turn.results) {
    const prev = next[result.toolName] ?? { calls: 0, errors: 0, ms: 0 }
    next[result.toolName] = {
      calls: prev.calls + 1,
      errors: prev.errors + (result.isError ? 1 : 0),
      ms: prev.ms + (timing.toolMs?.[result.toolCallId] ?? 0),
    }
  }
  return next
}
