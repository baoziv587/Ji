import type { Usage } from '@earendil-works/pi-ai'
import type { Reducer } from '@ji.dev/kernel/reduce'
import type { AgentState, RunSummary, Turn, TurnTiming, UsageTotals } from './types.ts'
import { combine, count, filterInput, sum } from '@ji.dev/kernel/reduce'
import { isAssistant } from './message.ts'

// Declared first: the reducers below read them at module initialization.
export const NO_USAGE: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }
const NO_TOOLS: RunSummary['tools'] = {}

/**
 * Sums usage over the main model's messages kept in history. Plugin model calls and messages replaced by a history
 * rewrite are not there, so this can be less than what r.summary.usage reports.
 */
export function usageOf(state: AgentState): UsageTotals {
  return state.messages.filter(isAssistant).reduce((total, message) => addUsage(total, message.usage), NO_USAGE)
}

/** Adds one model call's usage to a total; Run.summary folds it over the model events. */
export function addUsage(total: UsageTotals, u: Usage): UsageTotals {
  return {
    input: total.input + u.input,
    output: total.output + u.output,
    cacheRead: total.cacheRead + u.cacheRead,
    cacheWrite: total.cacheWrite + u.cacheWrite,
    cost: total.cost + u.cost.total,
  }
}

export interface TimedTurn {
  turn: Turn
  timing: TurnTiming
}

/**
 * Run.summary, except usage: each field says which committed steps count (`on(kind, …)`) and what each one adds.
 * A new field is one more line here. Usage is folded from the model events instead, since spending does not wait for
 * a step to commit (RFC-0006 §5.5).
 */
export const summaryReducer: Reducer<TimedTurn, Omit<RunSummary, 'usage'>> = combine({
  turns: on('model', count),
  modelMs: sum(({ timing }) => timing.modelMs ?? 0),
  toolMs: sum(({ timing }) => Object.values(timing.toolMs ?? {}).reduce((a, b) => a + b, 0)),
  tools: on('model', { init: NO_TOOLS, reduce: addToolStats }),
  inputs: on(
    'input',
    sum(({ turn }) => turn.messages.length),
  ),
  rewrites: on('rewrite', count),
})

/* ── Internal ─────────────────────────────────────────── */

type TimedTurnOf<K extends Turn['kind']> = TimedTurn & { turn: Extract<Turn, { kind: K }> }

/** Only steps of this kind reach r; inside r, `turn` is already narrowed to that kind. */
function on<K extends Turn['kind'], Acc, Out>(
  kind: K,
  r: Reducer<TimedTurnOf<K>, Acc, Out>,
): Reducer<TimedTurn, Acc, Out> {
  return filterInput(r, (x: TimedTurn): x is TimedTurnOf<K> => x.turn.kind === kind)
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
