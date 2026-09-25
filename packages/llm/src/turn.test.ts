// Turn helpers: how a step is recorded, converted to the kernel's (action, obs), and written into history.
import type { ToolCall } from '@mariozechner/pi-ai'
import type { AgentState, Turn } from './types.ts'
import { fauxAssistantMessage, fauxToolCall } from '@mariozechner/pi-ai'
import { describe, expect, it } from 'vitest'
import { isIdle, user } from './message.ts'
import { toolResult } from './tool.ts'
import { actionOf, applyTurn, isModelAction, rewriteHistory, stop, turnOf } from './turn.ts'

const call: ToolCall = { type: 'toolCall', id: 't1', name: 'echo', arguments: {} }
const withCall = fauxAssistantMessage([fauxToolCall('echo', {})], { stopReason: 'toolUse' })
const answer = fauxAssistantMessage('done')
const result = toolResult(call, 'ok')

const turns: Turn[] = [
  { kind: 'model', message: withCall, results: [result] },
  { kind: 'input', messages: [user('more')], idle: true, interrupted: false },
  { kind: 'rewrite', messages: [user('summary')] },
]

describe('turnOf / actionOf', () => {
  it('round-trips every kind of Turn through the kernel (action, obs) pair', () => {
    for (const turn of turns) {
      expect(turnOf(...actionOf(turn))).toEqual(turn)
    }
  })

  it('only model turns carry tool results; the others have none', () => {
    expect(turns.map(t => actionOf(t)[1].length)).toEqual([1, 0, 0])
    expect(turns.map(t => isModelAction(actionOf(t)[0]))).toEqual([true, false, false])
  })
})

describe('applyTurn', () => {
  const state: AgentState = { messages: [user('q')], plugins: { p: 1 } }

  it('model: appends the message and its tool results', () => {
    expect(applyTurn(state, turns[0]).messages).toEqual([...state.messages, withCall, result])
  })

  it('input: appends the inserted messages', () => {
    expect(applyTurn(state, turns[1]).messages.map(m => m.content)).toEqual(['q', 'more'])
  })

  it('rewrite: replaces the whole history and keeps plugin state', () => {
    const rewritten = applyTurn(state, turns[2])
    expect(rewritten.messages.map(m => m.content)).toEqual(['summary'])
    expect(rewritten.plugins).toBe(state.plugins)
  })
})

describe('rewriteHistory / stop', () => {
  it('rewriteHistory is an act step carrying the new history', () => {
    expect(rewriteHistory([user('s')])).toMatchObject({
      tag: 'act',
      action: { kind: 'rewrite', messages: [{ content: 's' }] },
    })
  })

  it('stop ends with the last assistant message, even when it is followed by tool results', () => {
    expect(stop({ messages: [user('q'), answer, withCall, result], plugins: {} })).toEqual({
      tag: 'done',
      result: withCall,
    })
  })

  it('stop throws when there is no assistant message yet', () => {
    expect(() => stop({ messages: [user('q')], plugins: {} })).toThrow(/no assistant message/)
  })
})

describe('isIdle', () => {
  const idle = (...messages: AgentState['messages']): boolean => isIdle({ messages, plugins: {} })

  it('is idle for an empty history and after a final answer', () => {
    expect(idle()).toBe(true)
    expect(idle(user('q'), answer)).toBe(true)
  })

  it('is busy while a user message, a tool call or a tool result is waiting', () => {
    expect(idle(user('q'))).toBe(false)
    expect(idle(user('q'), withCall)).toBe(false)
    expect(idle(user('q'), withCall, result)).toBe(false)
  })
})
