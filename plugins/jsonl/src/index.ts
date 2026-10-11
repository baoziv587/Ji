// @ji.dev/plugin-jsonl: every run event as one line of JSON, for replay and debugging (RFC-0005 §4.3)
//
//   createAgent({ model, plugins: [jsonl(line => file.write(line + '\n'))] })
//
//   {"run":"…","session":"…","t":1,"type":"tool_start","call":{…}}
//
//   step_end carries the whole state after the step; it is left out unless asked for, because it grows with the
//   conversation. Errors become { name, message, kind? } so they survive JSON.
//
//   What the model streams (thinking, text, a tool call's arguments) is written a line an interval, its deltas joined:
//   a model streams a few characters a delta, and each tool_call_delta carries the arguments parsed so far, so a long
//   write logged a line a delta grows with the square of its length. Any other event writes the deltas held first.
//   compact joins a log's deltas the same way when it is read back.

import type { Plugin, RunEvent, RunInfo } from '@ji.dev/llm'
import { definePlugin } from '@ji.dev/llm'

/** One line of the log: an event, with the run and the session it is of. */
export type JsonlRecord = RunEvent & { run: string; session: string }

export interface JsonlOptions {
  /** Include step_end's state. Default false. */
  state?: boolean
  /** Milliseconds the deltas streamed are held and joined into one line. Default 1000; 0 writes each. */
  interval?: number
}

export function jsonl(write: (line: string) => void, { state = false, interval = 1000 }: JsonlOptions = {}): Plugin {
  // The deltas held, joined, and when the first of them came
  let held: DeltaRecord | undefined
  let since = 0

  const flush = (): void => {
    if (held !== undefined) {
      write(JSON.stringify(held, jsonSafe))
      held = undefined
    }
  }

  return definePlugin({
    name: 'jsonl',
    observe: (e, run) => {
      const record = recordOf(e, run, state)
      if (!isDelta(record)) {
        flush()
        write(JSON.stringify(record, jsonSafe))
        return
      }

      const now = Date.now()
      if (held !== undefined && continues(held, record)) {
        held = joined(held, record)
      } else {
        flush()
        held = record
        since = now
      }

      if (now - since >= interval) {
        flush()
      }
    },
  })
}

/** The records of a log with each run of deltas joined into one, as if written with no end to the interval. */
export function* compact(records: Iterable<JsonlRecord>): Generator<JsonlRecord> {
  let held: DeltaRecord | undefined
  for (const record of records) {
    if (held !== undefined && isDelta(record) && continues(held, record)) {
      held = joined(held, record)
      continue
    }

    if (held !== undefined) {
      yield held
      held = undefined
    }
    if (isDelta(record)) {
      held = record
    } else {
      yield record
    }
  }
  if (held !== undefined) {
    yield held
  }
}

type DeltaRecord = Extract<JsonlRecord, { type: 'thinking' | 'text' | 'tool_call_delta' }>

function isDelta(record: JsonlRecord): record is DeltaRecord {
  return record.type === 'thinking' || record.type === 'text' || record.type === 'tool_call_delta'
}

/** Whether next goes on from the deltas held: of the same run, kind and call. */
function continues(held: DeltaRecord, next: DeltaRecord): boolean {
  if (held.run !== next.run || held.type !== next.type) {
    return false
  }
  if (held.type === 'tool_call_delta' && next.type === 'tool_call_delta') {
    return held.call.id === next.call.id
  }
  return true
}

/** The deltas held and the next as one: the latest record, so a tool_call_delta keeps the arguments parsed so far. */
function joined(held: DeltaRecord, next: DeltaRecord): DeltaRecord {
  return { ...next, delta: held.delta + next.delta }
}

function recordOf(e: RunEvent, run: RunInfo, withState: boolean): JsonlRecord {
  const event = e.type === 'step_end' && !withState ? withoutState(e) : e
  return { run: run.id, session: run.session, ...event } as JsonlRecord
}

function withoutState({ state: _, ...rest }: Extract<RunEvent, { type: 'step_end' }>): object {
  return rest
}

function jsonSafe(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, ...('kind' in value ? { kind: value.kind } : {}) }
  }
  return value
}
