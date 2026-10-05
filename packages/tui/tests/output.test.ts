// The tail of a command's output: how many lines, and the last ones with text, as a row shows them
import { describe, expect, it } from 'vitest'
import { OutputTail } from '../src/output.ts'

describe('outputTail', () => {
  it('should count the lines a command writes, and keep its last ones with text, across chunks', () => {
    // Arrange
    const output = new OutputTail()

    // Act
    output.add({ fd: 1, text: 'one\n\x1B[32mtw' })
    output.add({ fd: 2, text: 'o\tpassed\x1B[0m\r\n\n' })

    // Assert
    expect(output.lines).toBe(3)
    expect(output.recent()).toEqual(['one', 'two  passed'])
  })

  it('should keep only the last five, and what a progress bar drew last', () => {
    // Arrange
    const output = new OutputTail()

    // Act
    output.add(Array.from({ length: 8 }, (_, i) => `line ${i}`).join('\n'))
    output.add('\n10%\r50%\r90%')

    // Assert
    expect(output.lines).toBe(9)
    expect(output.recent()).toEqual(['line 4', 'line 5', 'line 6', 'line 7', '90%'])
  })

  it('should take nothing from an update that is not text', () => {
    // Arrange
    const output = new OutputTail()

    // Act
    output.add({ questions: [] })
    output.add(undefined)

    // Assert
    expect(output.lines).toBe(0)
    expect(output.recent()).toEqual([])
  })
})
