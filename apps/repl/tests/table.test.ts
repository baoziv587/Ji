// A Markdown table as a grid: columns as wide as their text, aligned as the delimiter says, narrowed until it fits
import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { drawTable } from '../src/ui/markdown/table.ts'
import { widthOf } from '../src/ui/paint/text.ts'

describe('drawTable', () => {
  it('should draw a table that fits as wide as its text, each column aligned as its delimiter says', () => {
    // Arrange
    const markdown = '| Name | Width | Notes |\n|:--|:-:|--:|\n| 中文 | 2 | wide |\n| a | 1 | x |'

    // Act
    const lines = plain(drawTable(markdown, 80))

    // Assert
    expect(lines).toEqual([
      '┌──────┬───────┬───────┐',
      '│ Name │ Width │ Notes │',
      '├──────┼───────┼───────┤',
      '│ 中文 │   2   │  wide │',
      '├──────┼───────┼───────┤',
      '│ a    │   1   │     x │',
      '└──────┴───────┴───────┘',
    ])
  })

  it('should show inline Markdown without its marks, and a link with its address', () => {
    // Arrange
    const markdown = '| A | B |\n|---|---|\n| **bold** `code` | [docs](https://example.com) \\| more |'

    // Act
    const lines = plain(drawTable(markdown, 80))

    // Assert
    expect(lines[3]).toBe('│ bold code │ docs (https://example.com) | more │')
  })

  it('should narrow a table too wide, breaking its cells between words, every line inside the width', () => {
    // Arrange
    const notes = 'a long note that has to go on to more lines than one'
    const markdown = `| Key | Notes |\n|---|---|\n| first | ${notes} |\n| second | short |`

    // Act
    const lines = plain(drawTable(markdown, 30))

    // Assert
    expect(lines.every(line => widthOf(line) <= 30)).toBe(true)
    const cells = lines.filter(line => line.startsWith('│')).map(line => line.split('│').map(cell => cell.trim()))
    expect(cells[0]).toEqual(['', 'Key', 'Notes', ''])
    expect(
      cells
        .slice(1, -1)
        .map(cell => cell[2])
        .join(' '),
    ).toBe(notes)
    expect(cells.at(-1)).toEqual(['', 'second', 'short', ''])
  })

  it('should give up on a table when not one character of each column fits, or on what is not a table', () => {
    // Arrange: three columns need 3 * 3 + 1 columns of borders, and one for each
    const markdown = '| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |'

    // Act
    const narrowest = [12, 13].map(width => drawTable(markdown, width))
    const notTable = drawTable('| a | b |\nno delimiter', 80)

    // Assert
    expect(narrowest[0]).toBeUndefined()
    expect(plain(narrowest[1]).every(line => widthOf(line) === 13)).toBe(true)
    expect(notTable).toBeUndefined()
  })
})

// Helpers

function plain(lines: string[] | undefined): string[] {
  return (lines ?? []).map(line => stripVTControlCharacters(line))
}
