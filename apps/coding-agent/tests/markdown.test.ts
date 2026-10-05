// A reply's Markdown as it streams in: each line drawn as what its start shows it is, inline marks once they close
import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { Markdown } from '../src/ui/markdown/markdown.ts'
import { widthOf } from '../src/ui/paint/text.ts'

const WIDTH = 30

describe('markdown', () => {
  it('should draw headings without their marks, and a rule across the width', async () => {
    // Act
    const rows = await written('# Title\n## Part\n---\n#hashtag')

    // Assert
    expect(rows).toEqual(['Title', 'Part', '─'.repeat(WIDTH), '#hashtag'])
  })

  it('should draw list items with a marker for their depth, numbers and tasks', async () => {
    // Act
    const rows = await written('- one\n  - two\n    - three\n- back\n1. first\n- [ ] todo\n- [x] done\nafter')

    // Assert
    expect(rows).toEqual(['• one', '  ◦ two', '    ▪ three', '• back', '1. first', '☐ todo', '☑ done', 'after'])
  })

  it('should line up the rows an item or a quote wraps on to under its text, inside the width', async () => {
    // Arrange
    const words = 'a long item that has to go on to more rows than one'

    // Act
    const rows = await written(`- ${words}\n> ${words}`)

    // Assert
    expect(rows.every(row => widthOf(row) <= WIDTH)).toBe(true)
    const item = rows.filter(row => !row.startsWith('▎'))
    const quote = rows.filter(row => row.startsWith('▎'))
    expect(item[0]).toMatch(/^• a long/)
    expect(item.slice(1).every(row => /^ {2}\S/.test(row))).toBe(true)
    expect(item.map(row => row.slice(2).trim()).join(' ')).toBe(words)
    expect(quote.map(row => row.slice(2).trim()).join(' ')).toBe(words)
  })

  it('should show inline marks once they close, and leave alone what does not open a span', async () => {
    // Act
    const rows = await written(
      'Use **bold**, `code` and [docs](https://x.dev) here\n2*3 is snake_case_name, not **open\na \\*b\\* C:\\dir',
    )

    // Assert
    expect(rows).toEqual([
      'Use bold, code and docs',
      '(https://x.dev) here',
      '2*3 is snake_case_name, not',
      '**open',
      'a *b* C:\\dir',
    ])
  })

  it('should write the text before a mark at once, holding back only the span it may open', async () => {
    // Arrange
    const out = sink()
    const markdown = new Markdown(out.rows, () => WIDTH)

    // Act
    await markdown.write('plain words then **bo')
    const before = out.text()
    await markdown.write('ld** and')
    const after = out.text()

    // Assert
    expect(before).toBe('plain words then')
    expect(after).toBe('plain words then bold')
  })

  it('should still draw code and tables, after the Markdown around them', async () => {
    // Act
    const rows = await written('Look:\n```\nlet x = 1\n```\n| a |\n|---|\n| **b** |\n> done')

    // Assert
    expect(rows).toEqual(['Look:', '```', 'let x = 1', '```', '┌───┐', '│ a │', '├───┤', '│ b │', '└───┘', '▎ done'])
  })

  it('should say how many rows of a table it holds back, and nothing once the table is drawn', async () => {
    // Arrange
    const out = sink()
    const markdown = new Markdown(out.rows, () => WIDTH)

    // Act
    await markdown.write('| a |\n')
    const header = markdown.describe()
    await markdown.write('|---|\n| 1 |\n| 2 |\n')
    const held = markdown.describe()
    const shown = out.text()
    await markdown.write('after\n')

    // Assert
    expect(header).toBe('')
    expect(held).toBe('table · 2 rows')
    expect(shown).toBe('')
    expect(markdown.describe()).toBe('')
  })
})

// Helpers

/** The rows `markdown` comes out as, without colors, streamed in a character at a time. */
async function written(markdown: string): Promise<string[]> {
  const out = sink()
  const writer = new Markdown(out.rows, () => WIDTH)
  for (const char of markdown) {
    await writer.write(char)
  }
  writer.end()
  return out.text().split('\n').slice(0, -1)
}

function sink(): { rows: { write: (text: string) => void; newline: () => void }; text: () => string } {
  let out = ''
  return {
    rows: {
      write: text => {
        out += text
      },
      newline: () => {
        out += '\n'
      },
    },
    text: () => stripVTControlCharacters(out),
  }
}
