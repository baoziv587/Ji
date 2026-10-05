// A call and its result in the two views: one row each, however long, and a file read in color
import type { ToolCall, ToolResultMessage } from '@ji.dev/llm'
import process from 'node:process'
import { stripVTControlCharacters } from 'node:util'
import { toolError } from '@ji.dev/llm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { describeArguments, describeDone, describeResult } from '../src/calls.ts'
import { widthOf } from '../src/text.ts'

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
  it('should keep a call to one row by the columns it shows in, wide characters too', () => {
    // Arrange
    const write = call('bash', { command: `echo ${'很长的中文参数'.repeat(20)}` })

    // Act
    const row = describeDone(write, result(write, 'done', false))

    // Assert
    expect(row).not.toContain('\n')
    expect(widthOf(row)).toBeLessThanOrEqual(COLUMNS - 4)
  })

  it('should keep the error in the same row, with at least half of it', () => {
    // Arrange
    const failing = call('bash', { command: 'x'.repeat(200) })

    // Act
    const row = stripVTControlCharacters(describeDone(failing, result(failing, 'command not found', true)))

    // Assert
    expect(widthOf(row)).toBeLessThanOrEqual(COLUMNS - 4)
    expect(row).toMatch(/…\) {2}command not found$/)
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
    expect(widthOf(content)).toBeLessThanOrEqual(COLUMNS - 4)
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
})

// Helpers

function call(name: string, args: Record<string, unknown>): ToolCall {
  return { type: 'toolCall', id: 'c', name, arguments: args }
}

function result(of: ToolCall, text: string, isError: boolean): ToolResultMessage {
  return { ...toolError(of, text), isError }
}
