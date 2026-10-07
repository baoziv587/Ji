// The frame around the questions: how its rows wrap to the terminal
import type { Question } from '../src/index.ts'
import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { start } from '../src/choosing.ts'
import { draw, wrapWithPrefix } from '../src/terminal.ts'

const COLUMNS = 40

/** The frame in a 40-column terminal, colors taken off, as lines. */
function drawn(questions: Question[]): string[] {
  const look = {
    paint: (d: string) => d,
    wrap: (t: string, at: Parameters<typeof wrapWithPrefix>[2]) => wrapWithPrefix(COLUMNS, t, at),
  }
  return stripVTControlCharacters(draw(start(questions), 'open', look)).split('\n')
}

describe('draw', () => {
  it('should start the other lines of a long option under its label, past the mark, without a leading space', () => {
    // Arrange: a label that wraps twice at 40 columns, broken at its spaces
    const label = `${'a'.repeat(30)} ${'b'.repeat(30)} ${'c'.repeat(10)}`
    const [first, second, third] = drawn([{ title: 'Pick', options: [{ value: 'x', label }] }]).slice(2)

    // Assert
    expect(first).toBe(`│  ● ${'a'.repeat(30)}`)
    expect(second).toBe(`│    ${'b'.repeat(30)}`)
    expect(third).toBe(`│    ${'c'.repeat(10)}`)
  })

  it('should keep the lines of a detail where they are, so a diff keeps its indentation', () => {
    // Arrange: two questions, so the detail shows above the options
    const detail = `  indented line that is long enough to wrap around`
    const questions: Question[] = [
      { title: 'One', detail, options: [{ value: 'x', label: 'x' }] },
      { title: 'Two', options: [{ value: 'y', label: 'y' }] },
    ]

    // Act
    const lines = drawn(questions)

    // Assert: the detail's first line keeps its indentation and its spaces, and the next one starts at the rail
    expect(lines.slice(2, 5)).toEqual(['│  One', '│    indented line that is long enough ', '│  to wrap around'])
  })
})
