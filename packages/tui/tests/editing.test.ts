// What keys do to the input line, without a terminal, and how it is drawn
import type { Editing, Keypress } from '../src/editing.ts'
import { stripVTControlCharacters } from 'node:util'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { applyKey, editingText, EMPTY_EDITING, renderInputLine } from '../src/editing.ts'
import { displayWidth } from '../src/text.ts'

const MOVES: Keypress[] = [
  { name: 'left' },
  { name: 'right' },
  { name: 'home' },
  { name: 'end' },
  { name: 'a', ctrl: true },
  { name: 'e', ctrl: true },
]

const line: fc.Arbitrary<Editing> = fc.record({
  before: fc.constantFrom('', 'ab', '中文', 'a👍🏽', 'go on '),
  after: fc.constantFrom('', 'cd', '文字', '👍🏽b'),
  pasting: fc.constant(false),
})

describe('edit', () => {
  it('should always keep the text while the cursor moves', () => {
    fc.assert(
      fc.property(line, fc.array(fc.constantFrom(...MOVES)), (start, keys) => {
        // Act
        const end = keys.reduce(applyKey, start)

        // Assert
        expect(editingText(end)).toBe(editingText(start))
      }),
    )
  })

  it('should move and delete a whole character, wide or joined', () => {
    // Arrange
    const s: Editing = { ...EMPTY_EDITING, before: '中👍🏽', after: '' }

    // Act
    const left = applyKey(s, { name: 'left' })
    const deleted = applyKey(s, { name: 'backspace' })

    // Assert
    expect(left).toMatchObject({ before: '中', after: '👍🏽' })
    expect(deleted.before).toBe('中')
  })

  it('should insert what is typed at the cursor, and ignore control characters', () => {
    // Arrange
    const s: Editing = { ...EMPTY_EDITING, before: 'a', after: 'c' }

    // Act
    const typed = applyKey(s, { char: 'b' })
    const escaped = applyKey(s, { name: 'escape', char: '\x1B' })

    // Assert
    expect(editingText(typed)).toBe('abc')
    expect(escaped).toBe(s)
  })

  it('should turn a line break inside a paste into a space, and leave one outside it to the caller', () => {
    // Act
    const pasted = [
      { name: 'paste-start' },
      { char: 'a' },
      { name: 'return' },
      { char: 'b' },
      { name: 'paste-end' },
    ].reduce(applyKey, EMPTY_EDITING)
    const outside = applyKey(pasted, { name: 'return' })

    // Assert
    expect(editingText(pasted)).toBe('a b')
    expect(outside).toBe(pasted)
  })

  it('should delete the word before the cursor', () => {
    // Act
    const s = applyKey({ ...EMPTY_EDITING, before: 'run the tests ', after: 'now' }, { name: 'w', ctrl: true })

    // Assert
    expect(editingText(s)).toBe('run the now')
  })
})

describe('renderInputLine', () => {
  it('should show the placeholder while nothing is typed, with the cursor after the prompt', () => {
    // Act
    const { line, column } = renderInputLine(EMPTY_EDITING, 20, { placeholder: 'Ask anything' })

    // Assert
    expect(stripVTControlCharacters(line)).toBe('› Ask anything')
    expect(column).toBe(2)
  })

  it('should scroll a long line sideways, keeping the cursor in view', () => {
    // Arrange
    const editing = { ...EMPTY_EDITING, before: `${'a'.repeat(50)}end`, after: 'more' }

    // Act
    const { line, column } = renderInputLine(editing, 20, { placeholder: '' })

    // Assert
    const shown = stripVTControlCharacters(line)
    expect(shown.slice(0, column)).toMatch(/aend$/)
    expect(displayWidth(shown)).toBeLessThanOrEqual(20)
  })
})
