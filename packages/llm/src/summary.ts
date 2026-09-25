import type { Reducer } from '@gaoxiang.ai/kernel/reduce'
import type { AssistantMessage, Usage } from '@mariozechner/pi-ai'
import type { AgentState, RunSummary, Turn, TurnTiming, UsageTotals } from './types.ts'
import { combine, filterInput, mapInput } from '@gaoxiang.ai/kernel/reduce'
import { isAssistant } from './message.ts'

// Declared first: the reducers below read them at module initialization.
const NO_USAGE: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }
const NO_TOOLS: RunSummary['tools'] = {}
const count: Reducer<unknown, number> = sum(() => 1)

/** Usage of assistant messages. usageOf and Run.summary share it, so the two always agree (promise 5). */
const usage: Reducer<AssistantMessage, UsageTotals> = {
  init: NO_USAGE,
  reduce: (total, message) => addUsage(total, message.usage),
}

/** Sums usage over the assistant messages in state; messages replaced by a history rewrite no longer count. */
export function usageOf(state: AgentState): UsageTotals {
  return state.messages.filter(isAssistant).reduce(usage.reduce, usage.init)
}

export interface TimedTurn {
  turn: Turn
  timing: TurnTiming
}

/**
 * Run.summary: each field says which steps count (`on(kind, …)`) and what each one adds.
 * A new field is one more line here.
 */
export const summaryReducer: Reducer<TimedTurn, RunSummary> = combine({
  turns: on('model', count),
  usage: on('model', mapInput(usage, ({ turn }) => turn.message)),
  modelMs: sum(({ timing }) => timing.modelMs ?? 0),
  toolMs: sum(({ timing }) => Object.values(timing.toolMs ?? {}).reduce((a, b) => a + b, 0)),
  tools: on('model', { init: NO_TOOLS, reduce: addToolStats }),
  inputs: on('input', sum(({ turn }) => turn.messages.length)),
  rewrites: on('rewrite', count),
})

/* ── Internal ─────────────────────────────────────────── */

type TimedTurnOf<K extends Turn['kind']> = TimedTurn & { turn: Extract<Turn, { kind: K }> }

/** Only steps of this kind reach r; inside r, `turn` is already narrowed to that kind. */
function on<K extends Turn['kind'], Acc, Out>(kind: K, r: Reducer<TimedTurnOf<K>, Acc, Out>): Reducer<TimedTurn, Acc, Out> {
  return filterInput(r, (x: TimedTurn): x is TimedTurnOf<K> => x.turn.kind === kind)
}

function sum<In>(amount: (input: In) => number): Reducer<In, number> {
  return { init: 0, reduce: (n, input) => n + amount(input) }
}


function addUsage(total: UsageTotals, u: Usage): UsageTotals {
  return {
    input: total.input + u.input,
    output: total.output + u.output,
    cacheRead: total.cacheRead + u.cacheRead,
    cacheWrite: total.cacheWrite + u.cacheWrite,
    cost: total.cost + u.cost.total,
  }
}

function addToolStats(stats: RunSummary['tools'], { turn, timing }: TimedTurnOf<'model'>): RunSummary['tools'] {
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
