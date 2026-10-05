// What keys do to the input line, without a terminal
import type { Editing, Keypress } from '../src/ui/screen/editing.ts'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { edit, EMPTY, textOf } from '../src/ui/screen/editing.ts'

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
        const end = keys.reduce(edit, start)

        // Assert
        expect(textOf(end)).toBe(textOf(start))
      }),
    )
  })

  it('should move and delete a whole character, wide or joined', () => {
    // Arrange
    const s: Editing = { ...EMPTY, before: '中👍🏽', after: '' }

    // Act
    const left = edit(s, { name: 'left' })
    const deleted = edit(s, { name: 'backspace' })

    // Assert
    expect(left).toMatchObject({ before: '中', after: '👍🏽' })
    expect(deleted.before).toBe('中')
  })

  it('should insert what is typed at the cursor, and ignore control characters', () => {
    // Arrange
    const s: Editing = { ...EMPTY, before: 'a', after: 'c' }

    // Act
    const typed = edit(s, { char: 'b' })
    const escaped = edit(s, { name: 'escape', char: '\x1B' })

    // Assert
    expect(textOf(typed)).toBe('abc')
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
    ].reduce(edit, EMPTY)
    const outside = edit(pasted, { name: 'return' })

    // Assert
    expect(textOf(pasted)).toBe('a b')
    expect(outside).toBe(pasted)
  })

  it('should delete the word before the cursor', () => {
    // Act
    const s = edit({ ...EMPTY, before: 'run the tests ', after: 'now' }, { name: 'w', ctrl: true })

    // Assert
    expect(textOf(s)).toBe('run the now')
  })
})
