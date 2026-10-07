// A task without a terminal: the tools run unasked, the outcome carries the answer or the failure, and a timeout
// takes a running command down with the run
import type { Api, AssistantMessage, Model } from '@ji.dev/llm'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { jsonl } from '@ji.dev/plugin-jsonl'
import { assistantMessage, createFakeModel, toolUse } from '@ji.dev/testing'
import { describe, expect, it, onTestFinished } from 'vitest'
import { runTask } from '../src/headless/task.ts'

describe('runTask', () => {
  it('should run the task with the tools unasked and answer with the last reply', async () => {
    // Arrange
    const root = scratch()
    const model = faux([
      assistantMessage([toolUse('bash', { command: 'echo hello > out.txt' })]),
      assistantMessage('written'),
    ])
    const lines: string[] = []

    // Act
    const outcome = await runTask({
      root,
      task: 'write hello',
      model,
      thinking: 'off',
      plugins: [jsonl(l => lines.push(l))],
    })

    // Assert
    expect(outcome.outcome).toBe('done')
    expect(outcome).toMatchObject({ text: 'written', summary: { turns: 2, tools: { bash: { calls: 1, errors: 0 } } } })
    expect(readFileSync(join(root, 'out.txt'), 'utf8')).toBe('hello\n')
    expect(lines.map(l => JSON.parse(l).type)).toContain('run_end')
  })

  it('should abort a run past its timeout, command included', async () => {
    // Arrange
    const root = scratch()
    const marker = join(root, 'after')
    const model = faux([
      assistantMessage([toolUse('bash', { command: `sleep 2 && touch ${marker}` })]),
      assistantMessage('never'),
    ])

    // Act
    const started = Date.now()
    const outcome = await runTask({ root, task: 'wait', model, thinking: 'off', timeoutMs: 200 })
    const elapsed = Date.now() - started
    await new Promise(resolve => setTimeout(resolve, 2_300))

    // Assert
    expect(outcome.outcome).toBe('failed')
    expect(outcome).toMatchObject({ error: { kind: 'aborted', message: expect.stringContaining('timed out') } })
    expect(elapsed).toBeLessThan(2_000)
    expect(outcome.summary).toBeDefined()
    expect(() => readFileSync(marker)).toThrow()
  }, 10_000)

  it('should stop from outside through the signal', async () => {
    // Arrange
    const root = scratch()
    const model = faux([assistantMessage([toolUse('bash', { command: 'sleep 5' })]), assistantMessage('never')])
    const stopping = new AbortController()
    setTimeout(() => stopping.abort(new Error('stopped by SIGTERM')), 100)

    // Act
    const outcome = await runTask({ root, task: 'wait', model, thinking: 'off', signal: stopping.signal })

    // Assert
    expect(outcome).toMatchObject({
      outcome: 'failed',
      error: { kind: 'aborted', message: expect.stringContaining('SIGTERM') },
    })
  })
})

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'headless-'))
  writeFileSync(join(dir, '.keep'), '')
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function faux(responses: AssistantMessage[]): Model<Api> {
  const fake = createFakeModel(responses)
  onTestFinished(() => fake.dispose())
  return fake.model
}
