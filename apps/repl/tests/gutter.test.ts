// A reply after the rail: a line too long for the terminal goes on in rows of its own, each after the rail
import process from 'node:process'
import { Writable } from 'node:stream'
import { stripVTControlCharacters } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { widthOf } from '../src/ui/paint/text.ts'
import { Gutter } from '../src/ui/reply/gutter.ts'

const COLUMNS = 40

/** The rail and the two spaces after it. */
const RAIL = '│  '

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

describe('gutter', () => {
  it('should break a long line between words, every row after the rail, however it streams in', async () => {
    // Arrange
    const line = 'From Haskell to TypeScript, a few things that do not carry over one to one, and why each one differs.'

    // Act: in pieces that cut words in two
    const rows = await written(line.match(/.{1,7}/g) ?? [])

    // Assert
    expect(rows.length).toBeGreaterThan(2)
    expect(rows.every(row => row.startsWith(RAIL) && widthOf(row) < COLUMNS)).toBe(true)
    // A space where a row breaks is left out, or left at the end of the row
    expect(rows.map(row => row.slice(RAIL.length).trimEnd()).join(' ')).toBe(line)
  })

  it('should break text without spaces wherever a row fills, and keep punctuation at the end of a row', async () => {
    // Arrange
    const line =
      '从 Haskell 翻过来时几个不对应之处：可辨识联合、没有标准的 Either、回溯靠位置存档和内部异常，还有踩到的坑。'

    // Act
    const rows = await written([line])

    // Assert
    expect(rows.length).toBeGreaterThan(1)
    expect(rows.every(row => row.startsWith(RAIL) && widthOf(row) < COLUMNS)).toBe(true)
    expect(rows.some(row => /^│ {2}[，。：、]/.test(row))).toBe(false)
    expect(
      rows
        .map(row => row.slice(RAIL.length))
        .join('')
        .replaceAll(' ', ''),
    ).toBe(line.replaceAll(' ', ''))
  })

  it('should cut a long line of code into rows after the rail, in its colors', async () => {
    // Arrange
    const code = `const message = ${JSON.stringify('x'.repeat(80))}`

    // Act
    const rows = await written([`\`\`\`ts\n${code}\n\`\`\`\n`])

    // Assert
    expect(rows[0]).toBe(`${RAIL}\`\`\`ts`)
    expect(rows.at(-1)).toBe(`${RAIL}\`\`\``)
    const body = rows.slice(1, -1)
    expect(body.length).toBeGreaterThan(1)
    expect(body.every(row => row.startsWith(RAIL) && widthOf(row) < COLUMNS)).toBe(true)
    expect(body.map(row => row.slice(RAIL.length)).join('')).toBe(code)
  })

  it('should leave short lines as they are, with a bare rail for a blank one', async () => {
    // Act
    const rows = await written(['one\n', '\ntwo'])

    // Assert
    expect(rows).toEqual([`${RAIL}one`, '│', `${RAIL}two`])
  })
})

// Helpers

/** What the answer's text comes out as, a row at a time, without colors; the bare rail that opens it is left out. */
async function written(chunks: string[]): Promise<string[]> {
  let out = ''
  const both = new Writable({
    write(chunk: Uint8Array, _encoding, done) {
      out += String(chunk)
      done()
    },
  })
  const gutter = new Gutter({ brief: both, full: both }, both)

  for (const chunk of chunks) {
    await gutter.write(chunk, 'text')
  }
  gutter.end()

  return stripVTControlCharacters(out).split('\n').slice(1, -1)
}
