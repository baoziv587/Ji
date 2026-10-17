// A session read back from its log, the lines @ji.dev/plugin-jsonl wrote: the history to go on from, and the events a
// client shows for it. A reply that did not finish took the conversation back to before it (agent/conversation.ts),
// so only the steps of runs that ended done count toward the history; a client still sees what the others did.

import type { AgentState, Turn } from '@ji.dev/llm'
import type { JsonlRecord } from '@ji.dev/plugin-jsonl'
import type { Outcome, Unnumbered } from './events.ts'
import { applyTurn } from '@ji.dev/llm'
import { UsageMeter } from '../agent/meter.ts'
import { eventOf, outcomeOf, spentOf } from './events.ts'

/** One line of a session's log. */
export type LogRecord = JsonlRecord

export interface History {
  state: AgentState
  events: Unnumbered[]
  /** How the last run ended; none before the first, or when it never ended. */
  outcome?: Outcome
  /** What the runs spent, untimed: they ran at another time. */
  meter: UsageMeter
}

const EMPTY_STATE: AgentState = { messages: [], plugins: {} }

export function historyOf(records: readonly LogRecord[]): History {
  const events: Unnumbered[] = []
  const meter = new UsageMeter()
  const outcome = replay(records, meter, event => events.push(event))
  return { state: stateOf(records), events, outcome, meter }
}

/**
 * The history to go on from: `state`, the history up to the first of `records`, with the steps of the runs among them
 * that ended done.
 */
export function stateOf(records: readonly LogRecord[], state: AgentState = EMPTY_STATE): AgentState {
  const turns = new Map<string, Turn[]>()
  const done = new Set<string>()
  for (const record of records) {
    if (!turns.has(record.run)) {
      turns.set(record.run, [])
    }
    if (record.type === 'step_end') {
      turns.get(record.run)!.push(record.turn)
    }
    if (record.type === 'run_end' && outcomeOf(record).outcome === 'done') {
      done.add(record.run)
    }
  }

  for (const [run, steps] of turns) {
    if (done.has(run)) {
      state = steps.reduce(applyTurn, state)
    }
  }
  return state
}

/**
 * Lines of the log as a client is shown them: their events go to `push`, what they spent to `meter`. Returns how the
 * last run among them ended; none when none did.
 */
export function replay(
  records: readonly LogRecord[],
  meter: UsageMeter,
  push: (event: Unnumbered) => void,
): Outcome | undefined {
  let outcome: Outcome | undefined
  for (const record of records) {
    meter.take(record, false)
    if (record.type === 'run_end') {
      outcome = outcomeOf(record).outcome
    }
    const event = clientEventOf(record)
    if (event !== undefined) {
      push(event)
    }
  }
  return outcome
}

/** What a client shows of a line of the log: a run's end is the reply's, with what it spent. */
export function clientEventOf(record: LogRecord): Unnumbered | undefined {
  if (record.type === 'run_end') {
    return { type: 'reply_end', ...outcomeOf(record), usage: spentOf(record) }
  }
  return eventOf(record)
}
