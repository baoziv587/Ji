// Folds a run's event stream and checks the event protocol as it goes (RFC-0005 §3, RFC-0006 §5.4):
//
//   step_start ... step_end | step_cancelled      every in-step event carries the step's t; steps do not nest
//   model_start ... model_end | model_error       at most one model call open at a time
//   tool_call -> tool_start ... tool_end          a tool starts only for a call the model made, and ends once
//   run_end                                       exactly once, last, outside any step
//
// The same ledger is fed from a plugin's observe and from `for await (const e of run)`: both must see the same
// sequence, so each keeps a digest of (t, type) to compare at the end. Memory stays flat however long the run is.

import type { RunEvent } from '@ji.dev/llm'

export interface LedgerSummary {
  events: number
  /** FNV-1a over every event's t and type, in order. */
  digest: number
  byType: Record<string, number>
  /** The main model's text deltas, joined. */
  text: string
  violations: string[]
}

export interface Ledger {
  push: (e: RunEvent) => void
  finish: () => LedgerSummary
}

/** Enough to point at the problem; a broken run would otherwise report the same violation thousands of times. */
const MAX_VIOLATIONS = 20

// 32-bit FNV-1a, in decimal: the formatter and the linter disagree on the case of hex digits
const FNV_OFFSET = 2166136261
const FNV_PRIME = 16777619

export function createLedger(): Ledger {
  const byType: Record<string, number> = {}
  const text: string[] = []
  const violations: string[] = []
  const madeCalls = new Set<string>()
  const openTools = new Set<string>()
  let events = 0
  let digest = FNV_OFFSET
  let step: number | undefined
  let lastT = 0
  let modelOpen = false
  let ended = false

  const violate = (message: string): void => {
    if (violations.length < MAX_VIOLATIONS) {
      violations.push(message)
    }
  }

  function push(e: RunEvent): void {
    events++
    byType[e.type] = (byType[e.type] ?? 0) + 1
    digest = fnv(digest, `${e.t}|${e.type};`)

    const where = `#${events} ${e.type}@t${e.t}`
    if (ended) {
      violate(`${where}: event after run_end`)
    }
    if (e.t < lastT) {
      violate(`${where}: t went back from ${lastT}`)
    }
    lastT = e.t

    switch (e.type) {
      case 'step_start':
        if (step !== undefined) {
          violate(`${where}: step_start inside step ${step}`)
        }
        step = e.t
        return
      case 'run_end':
        if (step !== undefined) {
          violate(`${where}: run_end inside step ${step}`)
        }
        ended = true
        return
    }

    if (step === undefined) {
      violate(`${where}: outside any step`)
    } else if (e.t !== step) {
      violate(`${where}: in step ${step}`)
    }

    switch (e.type) {
      case 'step_end':
        if (modelOpen || openTools.size > 0) {
          violate(`${where}: step ended with ${modelOpen ? 'a model call' : `${openTools.size} tool calls`} open`)
        }
        step = undefined
        break
      case 'step_cancelled':
        step = undefined
        modelOpen = false
        openTools.clear()
        break
      case 'model_start':
        if (modelOpen) {
          violate(`${where}: a model call is already open`)
        }
        modelOpen = true
        break
      case 'model_end':
      case 'model_error':
        if (!modelOpen) {
          violate(`${where}: no model call open`)
        }
        modelOpen = false
        break
      case 'text':
        text.push(e.delta)
        break
      case 'tool_call':
        madeCalls.add(e.call.id)
        break
      case 'tool_start':
        if (!madeCalls.has(e.call.id)) {
          violate(`${where}: ${e.call.id} was never called by the model`)
        }
        if (openTools.has(e.call.id)) {
          violate(`${where}: ${e.call.id} started twice`)
        }
        openTools.add(e.call.id)
        break
      case 'tool_update':
        if (!openTools.has(e.call.id)) {
          violate(`${where}: update for ${e.call.id}, which is not running`)
        }
        break
      case 'tool_end':
        if (!openTools.delete(e.call.id)) {
          violate(`${where}: ${e.call.id} ended without starting`)
        }
        break
    }
  }

  function finish(): LedgerSummary {
    if (!ended) {
      violate('run_end never came')
    }
    if (step !== undefined) {
      violate(`step ${step} never ended`)
    }
    return { events, digest, byType, text: text.join(''), violations }
  }

  return { push, finish }
}

/** 32-bit FNV-1a, continued from `hash`. */
function fnv(hash: number, s: string): number {
  let h = hash
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, FNV_PRIME)
  }
  return h >>> 0
}
