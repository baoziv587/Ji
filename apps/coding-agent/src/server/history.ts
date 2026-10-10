// A session read back from its log, the lines @ji.dev/plugin-jsonl wrote: the history to go on from, and the events a
// client shows for it. A reply that did not finish took the conversation back to before it (agent/conversation.ts),
// so only the steps of runs that ended done count toward the history; a client still sees what the others did.

import type { AgentState, Message, RunEvent, Turn } from '@ji.dev/llm'
import type { Outcome, Unnumbered } from './events.ts'
import { UsageMeter } from '../agent/meter.ts'
import { eventOf, outcomeOf, usageOf } from './events.ts'

/** One line of a session's log. */
export type LogRecord = RunEvent & { run: string; session: string }

export interface History {
  state: AgentState
  events: Unnumbered[]
  /** How the last run ended; none before the first, or when it never ended. */
  outcome?: Outcome
  /** What the runs spent, untimed: they ran at another time. */
  meter: UsageMeter
}

export function historyOf(records: readonly LogRecord[]): History {
  const turns = new Map<string, Turn[]>()
  const done = new Set<string>()
  const events: Unnumbered[] = []
  const meter = new UsageMeter()
  let outcome: Outcome | undefined

  for (const record of records) {
    meter.take(record, false)

    if (!turns.has(record.run)) {
      turns.set(record.run, [])
    }
    if (record.type === 'step_end') {
      turns.get(record.run)!.push(record.turn)
    }
    if (record.type === 'run_end') {
      const ended = outcomeOf(record)
      outcome = ended.outcome
      if (ended.outcome === 'done') {
        done.add(record.run)
      }
      events.push({ type: 'reply_end', ...ended, usage: usageOf(record) })
      continue
    }
    const event = eventOf(record)
    if (event !== undefined) {
      events.push(event)
    }
  }

  let messages: Message[] = []
  for (const [run, steps] of turns) {
    if (done.has(run)) {
      messages = steps.reduce(apply, messages)
    }
  }
  return { state: { messages, plugins: {} }, events, outcome, meter }
}

/** What a step did to the history, as the session applies it. */
function apply(messages: Message[], turn: Turn): Message[] {
  switch (turn.kind) {
    case 'model':
      return [...messages, turn.message, ...turn.results]
    case 'input':
      return [...messages, ...turn.messages]
    case 'rewrite':
      return turn.messages
  }
}
