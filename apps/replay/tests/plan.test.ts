import type { Script, ScriptTurn } from '../src/script.ts'
import { describe, expect, it } from 'vitest'
import { planOf } from '../src/plan.ts'

const turn = (text: string, calls = 1): ScriptTurn => ({
  text,
  calls: Array.from({ length: calls }, (_, i) => ({
    id: `${text}-${i}`,
    name: 'bash',
    cmd: `${text} ${i}`,
    obs: 'ok',
  })),
  synthetic: false,
})

// Two segments: a (tools), b (tools), c (done) | d (done)
const SCRIPT: Script = {
  system: '',
  segments: [
    { input: 'task', turns: [turn('a'), turn('b', 2), turn('c', 0)] },
    { input: 'more', turns: [turn('d', 0)] },
  ],
  tools: ['bash'],
}

const kinds = (script: Script, steer: number, interrupt: number): string[] =>
  planOf(script, { steer, interrupt }).steps.map(s =>
    s.kind === 'model' ? s.turn.text : `${s.idle ? 'idle' : s.interrupted ? 'now' : 'step'}:${s.text.split(')')[0]}`,
  )

describe('planOf', () => {
  it('should follow the script alone when nothing is sent', () => {
    // Act
    const plan = planOf(SCRIPT)

    // Assert
    expect(kinds(SCRIPT, 0, 0)).toEqual(['idle:task', 'a', 'b', 'c', 'idle:more', 'd'])
    expect(plan.attempts.map(a => [a.turn.text, a.messages, a.lastRole])).toEqual([
      ['a', 1, 'user'],
      ['b', 3, 'toolResult'],
      ['c', 6, 'toolResult'],
      ['d', 8, 'user'],
    ])
    expect(plan.text).toBe('abcd')
  })

  it('should insert a steering message after the turn it was sent during, and only after turns with tools', () => {
    // Act
    const plan = planOf(SCRIPT, { steer: 1, interrupt: 0 })

    // Assert
    expect(kinds(SCRIPT, 1, 0)).toEqual([
      'idle:task',
      'a',
      'step:(steer 1',
      'b',
      'step:(steer 2',
      'c',
      'idle:more',
      'd',
    ])
    expect(plan.attempts.map(a => a.send?.site)).toEqual(['model', 'tool', undefined, undefined])
    expect(plan.attempts[2]).toMatchObject({ messages: 8, lastRole: 'user' })
  })

  it('should ask for an interrupted turn again, after the interrupting message', () => {
    // Act
    const plan = planOf(SCRIPT, { steer: 0, interrupt: 2 })

    // Assert
    expect(kinds(SCRIPT, 0, 2)).toEqual([
      'idle:task',
      'a',
      'now:(interrupt 1',
      'b',
      'c',
      'idle:more',
      'now:(interrupt 2',
      'd',
    ])
    expect(plan.attempts.map(a => [a.turn.text, a.messages, a.send?.site])).toEqual([
      ['a', 1, undefined],
      ['b', 3, 'model'],
      ['b', 4, undefined],
      ['c', 7, undefined],
      ['d', 9, 'model'],
      ['d', 10, undefined],
    ])
    // Cancelled while the model answered: nothing of it was streamed
    expect(plan.text).toBe('abcd')
  })

  it('should count what an attempt cancelled while its tools ran has streamed and called', () => {
    // Act: interrupts alternate between the model and the tools
    const plan = planOf(SCRIPT, { steer: 0, interrupt: 1 })

    // Assert
    expect(plan.attempts.filter(a => a.send !== undefined).map(a => [a.turn.text, a.send?.site])).toEqual([
      ['a', 'model'],
      ['b', 'tool'],
      ['c', 'model'],
      ['d', 'model'],
    ])
    expect(plan.text).toBe('abbcd')
    expect(plan.cancelledCalls).toBe(2)
    expect(plan.interrupts).toBe(4)
  })
})
