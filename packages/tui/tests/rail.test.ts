// Rows beside the rail: the rail only once a row has text or turns out blank, and text as it streams in
import type { Buffer } from 'node:buffer'
import { Writable } from 'node:stream'
import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { PlainText } from '../src/markdown/plain.ts'
import { createRailRows } from '../src/rail.ts'

describe('createRailRows', () => {
  it('should put the rail before a row with text and on a blank one, and none after the last line ends', () => {
    // Arrange
    const { output, written } = collect()
    const rows = createRailRows(output, '|')

    // Act
    rows.write('one')
    rows.newline()
    rows.newline()
    rows.write('two')
    rows.newline()

    // Assert
    expect(written()).toBe('|  one\n|\n|  two\n')
  })
})

describe('plainText', () => {
  it('should break a long line between words, every row after the rail, however it streams in', async () => {
    // Arrange
    const { output, written } = collect()
    const text = new PlainText(createRailRows(output, '|'), () => 10)

    // Act
    await text.write('the quick bro')
    await text.write('wn fox\njumps')
    text.end()

    // Assert
    expect(stripVTControlCharacters(written()).split('\n')).toEqual(['|  the quick', '|  brown fox', '|  jumps', ''])
  })
})

function collect(): { output: Writable; written: () => string } {
  let out = ''
  const output = new Writable({
    write: (chunk: Buffer, _encoding, done) => {
      out += chunk.toString()
      done()
    },
  })
  return { output, written: () => out }
}
