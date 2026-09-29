// A plugin that takes part in every hook and checks what each one is handed, so a replay exercises the plugin
// system as well as the loop (RFC-0006):
//
//   state.reduce   counts turns by kind, and input steps inserted while idle or after an interrupt; after the run
//                  they must match the plan
//   input          sees each inserted message once
//   request        (via `before`) sees the committed history, unchanged, and ctx.own agrees with it
//   toolCall       (via `after`) gets back a result for the very call it passed on
//   record         runs once per committed step
//   observe        feeds a ledger, compared later with what `for await (const e of run)` saw
//
// Findings go into `violations` instead of being thrown: a throwing hook would fail the run and hide the rest.

import type { AgentState, Plugin, Turn } from '@ji.dev/llm'
import type { Ledger } from './ledger.ts'
import { after, before, definePlugin } from '@ji.dev/llm'
import { createLedger } from './ledger.ts'

export interface ProbeCounts {
  model: number
  input: number
  rewrite: number
  results: number
  /** Input steps inserted while the agent was idle. */
  idle: number
  /** Input steps at a boundary an interrupt produced. */
  interrupted: number
}

export interface Probe {
  plugin: Plugin<ProbeCounts>
  /** How many times each hook ran. */
  hooks: { input: number; request: number; toolCall: number; record: number }
  ledger: Ledger
  violations: string[]
}

export const NO_COUNTS: ProbeCounts = { model: 0, input: 0, rewrite: 0, results: 0, idle: 0, interrupted: 0 }

export function probe(): Probe {
  const hooks = { input: 0, request: 0, toolCall: 0, record: 0 }
  const violations: string[] = []
  const ledger = createLedger()

  const check = (ok: boolean, message: string): void => {
    if (!ok && violations.length < 20) {
      violations.push(message)
    }
  }

  const plugin = definePlugin({
    name: 'probe',
    state: { init: NO_COUNTS, reduce: countTurn },

    input: messages => {
      hooks.input += messages.length
      return messages
    },

    request: before((req, ctx) => {
      hooks.request++
      const seen = countsOf(ctx.state)
      check(ctx.by === undefined, `request ${hooks.request}: made by ${ctx.by}, not the main model`)
      check(req.state === ctx.state, `request ${hooks.request}: req.state is not the step's snapshot`)
      check(
        req.messages.length === ctx.state.messages.length,
        `request ${hooks.request}: ${req.messages.length} messages sent, ${ctx.state.messages.length} committed`,
      )
      check(
        ctx.own.model === seen.model && ctx.own.results === seen.results,
        `request ${hooks.request}: plugin state ${JSON.stringify(ctx.own)} disagrees with history ${JSON.stringify(seen)}`,
      )
      return req
    }),

    toolCall: after((result, call) => {
      hooks.toolCall++
      check(
        result.toolCallId === call.id && result.toolName === call.name,
        `toolCall ${call.id}: got the result of ${result.toolName}/${result.toolCallId}`,
      )
      return result
    }),

    record: (input, next) => {
      hooks.record++
      const state = next(input)
      if (input.turn.kind !== 'rewrite') {
        check(
          state.messages.length >= input.state.messages.length,
          `record ${hooks.record}: history shrank on a ${input.turn.kind} turn`,
        )
      }
      return state
    },

    observe: e => ledger.push(e),
  })

  return { plugin, hooks, ledger, violations }
}

function countTurn(own: ProbeCounts, turn: Turn): ProbeCounts {
  switch (turn.kind) {
    case 'model':
      return { ...own, model: own.model + 1, results: own.results + turn.results.length }
    case 'input':
      return {
        ...own,
        input: own.input + turn.messages.length,
        idle: own.idle + Number(turn.idle),
        interrupted: own.interrupted + Number(turn.interrupted),
      }
    case 'rewrite':
      return { ...own, rewrite: own.rewrite + 1 }
  }
}

/** What the counts must be for a history with no rewrites. */
function countsOf(state: AgentState): ProbeCounts {
  let model = 0
  let results = 0
  for (const m of state.messages) {
    if (m.role === 'assistant') {
      model++
    } else if (m.role === 'toolResult') {
      results++
    }
  }
  return { ...NO_COUNTS, model, results }
}
