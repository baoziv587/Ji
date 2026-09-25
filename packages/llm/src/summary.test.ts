// summaryReducer and usageOf are pure, so they are tested with hand-built turns and exact numbers.
// Timing and cost cannot be asserted exactly through the faux provider (timings vary, cost is always 0).
import type { AssistantMessage, ToolCall } from '@mariozechner/pi-ai'
import type { TimedTurn } from './summary.ts'
import type { RunSummary } from './types.ts'
import { resultOf } from '@gaoxiang.ai/kernel/reduce'
import { fauxAssistantMessage } from '@mariozechner/pi-ai'
import { describe, expect, it } from 'vitest'
import { user } from './message.ts'
import { summaryReducer, usageOf } from './summary.ts'
import { toolError, toolResult } from './tool.ts'

function assistant(input: number, output: number, cost: number): AssistantMessage {
  return {
    ...fauxAssistantMessage('reply'),
    usage: {
      input,
      output,
      cacheRead: 1,
      cacheWrite: 2,
      totalTokens: input + output,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
    },
  }
}

function summarize(turns: TimedTurn[]): RunSummary {
  return resultOf(summaryReducer, turns.reduce(summaryReducer.reduce, summaryReducer.init))
}

const call = (id: string, name: string): ToolCall => ({ type: 'toolCall', id, name, arguments: {} })

describe('usageOf', () => {
  it('sums every usage field over assistant messages and skips other roles', () => {
    const state = { messages: [user('q'), assistant(10, 5, 0.5), user('again'), assistant(3, 2, 0.25)], plugins: {} }
    expect(usageOf(state)).toEqual({ input: 13, output: 7, cacheRead: 2, cacheWrite: 4, cost: 0.75 })
  })

  it('is all zeros for an empty history', () => {
    expect(usageOf({ messages: [], plugins: {} })).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
    })
  })
})

describe('summaryReducer', () => {
  const withTools = assistant(100, 20, 0.5)
  const final = assistant(50, 10, 0.25)

  const turns: TimedTurn[] = [
    { turn: { kind: 'input', messages: [user('a'), user('b')], idle: true, interrupted: false }, timing: { ms: 1 } },
    {
      turn: {
        kind: 'model',
        message: withTools,
        results: [toolResult(call('t1', 'echo'), 'ok'), toolError(call('t2', 'fail'), 'nope')],
      },
      timing: { ms: 200, modelMs: 100, toolMs: { t1: 30, t2: 20 } },
    },
    { turn: { kind: 'rewrite', messages: [user('summary')] }, timing: { ms: 5 } },
    { turn: { kind: 'model', message: final, results: [] }, timing: { ms: 60, modelMs: 50, toolMs: {} } },
  ]

  it('counts each kind of step and sums timings and tool stats exactly', () => {
    expect(summarize(turns)).toEqual({
      turns: 2,
      usage: { input: 150, output: 30, cacheRead: 2, cacheWrite: 4, cost: 0.75 },
      modelMs: 150,
      toolMs: 50,
      tools: { echo: { calls: 1, errors: 0, ms: 30 }, fail: { calls: 1, errors: 1, ms: 20 } },
      inputs: 2,
      rewrites: 1,
    })
  })

  it('uses the same usage reducer as usageOf, so the two agree on the model turns (promise 5)', () => {
    expect(summarize(turns).usage).toEqual(usageOf({ messages: [withTools, final], plugins: {} }))
  })

  it('is all zeros before any step', () => {
    expect(summarize([])).toEqual({
      turns: 0,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
      modelMs: 0,
      toolMs: 0,
      tools: {},
      inputs: 0,
      rewrites: 0,
    })
  })
})
