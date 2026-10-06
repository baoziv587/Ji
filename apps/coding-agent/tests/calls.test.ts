// A call and its result in the two views: one row each, however long, and a file read in color
import type { ToolCall, ToolResultMessage } from '@ji.dev/llm'
import process from 'node:process'
import { stripVTControlCharacters } from 'node:util'
import { toolError } from '@ji.dev/llm'
import { displayWidth } from '@ji.dev/tui'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { describeArguments, describeDone, describeResult, describeWriting } from '../src/ui/reply/calls.ts'

const COLUMNS = 60

let columns: PropertyDescriptor | undefined

beforeEach(() => {
  columns = Object.getOwnPropertyDescriptor(process.stdout, 'columns')
  Object.defineProperty(process.stdout, 'columns', { value: COLUMNS, configurable: true })
})

afterEach(() => {
  if (columns === undefined) {
    Reflect.deleteProperty(process.stdout, 'columns')
  } else {
    Object.defineProperty(process.stdout, 'columns', columns)
  }
})

describe('describeDone', () => {
  it('should keep the error in the same row, with at least half of it', () => {
    // Arrange
    const failing = call('bash', { command: 'x'.repeat(200) })

    // Act
    const row = stripVTControlCharacters(describeDone(failing, result(failing, 'command not found', true)))

    // Assert
    expect(displayWidth(row)).toBeLessThanOrEqual(COLUMNS - 4)
    expect(row).toMatch(/…\) {2}command not found$/)
  })

  it('should say how many lines a result gave the model, when more than one', () => {
    // Arrange
    const grep = call('grep', { pattern: 'x' })

    // Act
    const many = stripVTControlCharacters(describeDone(grep, result(grep, 'a\nb\nc', false)))
    const one = stripVTControlCharacters(describeDone(grep, result(grep, 'a', false)))

    // Assert
    expect(many).toBe('grep(pattern: "x")  3 lines')
    expect(one).toBe('grep(pattern: "x")')
  })
})

describe('describeWriting', () => {
  it('should show a call being written on one row, with how much of it there is so far', () => {
    // Arrange
    const write = call('write', { path: 'a.md', content: '很长的故事'.repeat(500) })

    // Act
    const row = stripVTControlCharacters(describeWriting(write, 4400))

    // Assert
    expect(row).toMatch(/^write\(path: "a\.md", content: "很长的故事.*…\) {2}4\.4k chars$/)
    expect(displayWidth(row)).toBeLessThanOrEqual(COLUMNS - 4)
  })
})

describe('describeArguments', () => {
  it('should give each argument a row of its own', () => {
    // Act
    const rows = stripVTControlCharacters(
      describeArguments(call('edit', { path: 'a.ts', content: 'a\nb\n'.repeat(50) })),
    )

    // Assert
    const [name, path, content] = rows.split('\n')
    expect([name, path]).toEqual(['edit', 'path: "a.ts"'])
    expect(content).toMatch(/^content: "a\\nb\\n.*…$/)
    expect(displayWidth(content)).toBeLessThanOrEqual(COLUMNS - 4)
  })
})

describe('describeResult', () => {
  it('should show a file read numbered from its offset, and count the lines past the first 30', async () => {
    // Arrange
    const read = call('read', { path: 'a.ts', offset: 9 })
    const text = Array.from({ length: 40 }, (_, i) => `const n${i} = ${i}`).join('\n')

    // Act
    const rows = stripVTControlCharacters(await describeResult(read, result(read, text, false))).split('\n')

    // Assert
    expect(rows[0]).toBe('read')
    expect(rows[1]).toBe(' 9  const n0 = 0')
    expect(rows[30]).toBe('38  const n29 = 29')
    expect(rows.at(-1)).toBe('… 10 more lines')
  })

  it('should show the last lines of a command, where it says how it went', async () => {
    // Arrange
    const bash = call('bash', { command: 'pnpm test' })
    const text = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n')

    // Act
    const rows = stripVTControlCharacters(await describeResult(bash, result(bash, text, true))).split('\n')

    // Assert
    expect(rows.slice(0, 3)).toEqual(['bash', '… 10 more lines', 'line 10'])
    expect(rows.at(-1)).toBe('line 39')
  })
})

// Helpers

function call(name: string, args: Record<string, unknown>): ToolCall {
  return { type: 'toolCall', id: 'c', name, arguments: args }
}

function result(of: ToolCall, text: string, isError: boolean): ToolResultMessage {
  return { ...toolError(of, text), isError }
}
