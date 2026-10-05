// Lines of a headless terminal back into styled text
import type { Terminal } from '@xterm/headless'
import { stripVTControlCharacters } from 'node:util'
import xterm from '@xterm/headless'
import { describe, expect, it } from 'vitest'
import { lineOf, textOf } from '../src/screen/cells.ts'

async function written(text: string, cols = 10): Promise<Terminal> {
  const term = new xterm.Terminal({ cols, rows: 4, convertEol: true, allowProposedApi: true })
  await new Promise<void>(resolve => term.write(text, resolve))
  return term
}

describe('lineOf', () => {
  it('should give the line its styles back, and each wide character once', async () => {
    // Arrange
    const term = await written('\x1B[1mab\x1B[0m \x1B[31m中\x1B[0m')
    const buffer = term.buffer.active

    // Act
    const line = lineOf(buffer.getLine(0), term.cols, buffer.getNullCell())

    // Assert
    expect(stripVTControlCharacters(line)).toBe('ab 中     ')
    expect(line).toContain('\x1B[1mab')
    expect(line).toContain('\x1B[31m中')
  })
})

describe('textOf', () => {
  it('should join a wrapped line to the one before it, and drop the blank lines at the end', async () => {
    // Arrange
    const term = await written('0123456789abc\nnext\n')
    const buffer = term.buffer.active
    const lines = Array.from({ length: buffer.length }, (_, y) => buffer.getLine(y))

    // Act
    const text = textOf(lines, buffer.getNullCell())

    // Assert
    expect(text).toBe('0123456789abc\nnext')
  })
})
