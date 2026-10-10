// A session read back from its log: the steps of runs that ended done make the history, a run that failed or never
// ended is left out of it as the conversation went back on it, and a client still sees every run
import type { Message } from '@ji.dev/llm'
import type { LogRecord } from '../src/server/history.ts'
import { assistantMessage } from '@ji.dev/testing'
import { describe, expect, it } from 'vitest'
import { historyOf } from '../src/server/history.ts'

describe('historyOf', () => {
  it('should keep the steps of runs that ended done, and leave out the rest', () => {
    // Arrange
    const records = [
      ...run('a', 'hello', 'hi there', 'done'),
      ...run('b', 'break', 'half', 'failed'),
      ...run('c', 'again', 'sure', 'done'),
      ...run('d', 'crash', 'never ended'),
    ]

    // Act
    const { state, outcome } = historyOf(records)

    // Assert
    expect(state.messages.map(textOf)).toEqual(['hello', 'hi there', 'again', 'sure'])
    expect(outcome).toBe('done')
  })

  it('should give a client every run, with how each ended', () => {
    // Arrange
    const records = [...run('a', 'hello', 'hi', 'done'), ...run('b', 'stop', 'cut', 'stopped')]

    // Act
    const { events, outcome } = historyOf(records)

    // Assert
    expect(events.map(e => e.type)).toEqual(['user', 'text', 'reply_end', 'user', 'text', 'reply_end'])
    expect(events.filter(e => e.type === 'reply_end')).toMatchObject([{ outcome: 'done' }, { outcome: 'stopped' }])
    expect(outcome).toBe('stopped')
  })

  it('should take a rewrite as the whole history from then on', () => {
    // Arrange
    const summary: Message = { role: 'user', content: 'summary of before', timestamp: 0 }
    const records = [
      ...run('a', 'hello', 'hi', 'done'),
      record('b', { type: 'step_end', turn: { kind: 'rewrite', messages: [summary] } }),
      ...run('b', 'next', 'ok', 'done'),
    ]

    // Act
    const { state } = historyOf(records)

    // Assert
    expect(state.messages.map(textOf)).toEqual(['summary of before', 'next', 'ok'])
  })
})

/** A run's records as the jsonl plugin writes them: the message in, a text delta, the answer, and its end if any. */
function run(id: string, message: string, answer: string, outcome?: 'done' | 'failed' | 'stopped'): LogRecord[] {
  const reply = assistantMessage(answer)
  const records = [
    record(id, {
      type: 'step_end',
      turn: {
        kind: 'input',
        messages: [{ role: 'user', content: message, timestamp: 0 }],
        idle: true,
        interrupted: false,
      },
    }),
    record(id, { type: 'text', delta: answer }),
    record(id, { type: 'step_end', turn: { kind: 'model', message: reply, results: [] } }),
  ]
  if (outcome === 'done') {
    records.push(record(id, { type: 'run_end', outcome: 'done', result: reply, summary: summary() }))
  }
  if (outcome === 'failed' || outcome === 'stopped') {
    const error = { name: 'RunError', kind: 'aborted', message: outcome === 'stopped' ? 'stopped by user' : 'boom' }
    records.push(record(id, { type: 'run_end', outcome: 'failed', error, summary: summary() }))
  }
  return records
}

/** Through JSON, as the store reads a line back. */
function record(run: string, event: object): LogRecord {
  return JSON.parse(JSON.stringify({ run, session: 's', t: 0, ...event })) as LogRecord
}

function summary(): object {
  return {
    turns: 1,
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0 },
    modelMs: 0,
    toolMs: 0,
    tools: {},
    inputs: 1,
    rewrites: 0,
  }
}

function textOf(message: Message): string {
  if (typeof message.content === 'string') {
    return message.content
  }
  return message.content.map(part => ('text' in part ? part.text : '')).join('')
}
