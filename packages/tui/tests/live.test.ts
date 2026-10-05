// The live rows at the end of the content: whatever else is written goes in above them, and they go away without a trace
import xterm from '@xterm/headless'
import { afterEach, describe, expect, it } from 'vitest'
import { Live } from '../src/screen/live.ts'

let live: Live | undefined

afterEach(() => {
  live?.clear()
})

describe('live', () => {
  it('should keep its rows at the end, with what is written after them going in above', async () => {
    // Arrange
    const content = contentOf()
    live = content.live

    // Act
    content.put('one\n')
    live.follow(() => ['◐ bash', '│ out'])
    content.put('two\n')
    content.put('three\n')

    // Assert
    expect(await content.lines()).toEqual(['one', 'two', 'three', '◐ bash', '│ out'])
  })

  it('should wait for a row being written to end before showing again', async () => {
    // Arrange
    const content = contentOf()
    live = content.live
    live.follow(() => ['◐ table'])

    // Act
    content.put('half a')
    const during = await content.lines()
    content.put(' row\n')

    // Assert
    expect(during).toEqual(['half a'])
    expect(await content.lines()).toEqual(['half a row', '◐ table'])
  })

  it('should show different rows in place of the old ones, and take them all away at the end', async () => {
    // Arrange
    const content = contentOf()
    live = content.live
    content.put('one\n')
    live.follow(() => ['◐ a', '│ 1', '│ 2'])

    // Act
    live.follow(() => ['◓ a'])
    const changed = await content.lines()
    live.clear()

    // Assert
    expect(changed).toEqual(['one', '◓ a'])
    expect(await content.lines()).toEqual(['one'])
  })

  it('should step aside while a question is open, and come back under it', async () => {
    // Arrange
    const content = contentOf()
    live = content.live
    live.follow(() => ['◐ bash'])

    // Act
    live.pause()
    content.put('Run it?\n')
    const during = await content.lines()
    live.resume()

    // Assert
    expect(during).toEqual(['Run it?'])
    expect(await content.lines()).toEqual(['Run it?', '◐ bash'])
  })

  it('should take back a row the terminal wrapped after it narrowed', async () => {
    // Arrange
    const content = contentOf()
    live = content.live
    content.put('one\n')
    live.follow(() => ['◐ '.padEnd(30, 'x')])

    // Act
    content.resize(20)
    live.clear()

    // Assert
    expect(await content.lines()).toEqual(['one'])
  })

  it('should take back rows that scrolled the content up', async () => {
    // Arrange
    const content = contentOf(4)
    live = content.live
    content.put('one\ntwo\nthree\n')
    live.follow(() => ['◐ a', '│ b'])

    // Act
    content.put('four\n')
    live.clear()

    // Assert
    expect(await content.lines()).toEqual(['one', 'two', 'three', 'four'])
  })

  it('should keep to fewer rows than the content has, so all of them can be taken back', async () => {
    // Arrange
    const content = contentOf(4)
    live = content.live

    // Act
    live.follow(() => ['a', 'b', 'c', 'd', 'e'])

    // Assert
    expect(await content.lines()).toEqual(['a', 'b', 'c'])
  })
})

// Helpers

/** A content area as the screen keeps it: one headless terminal, every write going through the live rows. */
function contentOf(rows = 10) {
  let columns = 40
  const term = new xterm.Terminal({ cols: columns, rows, convertEol: true, allowProposedApi: true })
  const live = new Live(
    text => term.write(text),
    () => ({ columns, rows }),
  )

  return {
    live,
    put(text: string): void {
      term.write(live.erase())
      term.write(text)
      term.write(live.after(text, ['brief']))
    },
    resize(to: number): void {
      columns = to
      term.resize(to, rows)
    },
    /** Every line with text, the scrollback's too. */
    async lines(): Promise<string[]> {
      await new Promise<void>(resolve => term.write('', resolve))
      const buffer = term.buffer.active
      const all = Array.from({ length: buffer.length }, (_, y) => buffer.getLine(y)!.translateToString(true))
      return all.filter(line => line !== '')
    },
  }
}
