// The screen as a tree of elements: how the stacks share out the room, where the cursor ends up, and that nothing is
// drawn wider than it is given
import type { Element } from '../src/elements/element.ts'
import { stripVTControlCharacters } from 'node:util'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { EMPTY_EDITING } from '../src/editing.ts'
import { createFirstThatFitsElement } from '../src/elements/first-that-fits.ts'
import { stackHorizontally } from '../src/elements/horizontal-stack.ts'
import { createInputElement } from '../src/elements/input.ts'
import { padElement } from '../src/elements/pad.ts'
import { createRuleElement } from '../src/elements/rule.ts'
import { createTextElement } from '../src/elements/text.ts'
import { stackVertically } from '../src/elements/vertical-stack.ts'
import { createWrappedTextElement } from '../src/elements/wrapped-text.ts'
import { displayWidth } from '../src/text.ts'

describe('stackVertically', () => {
  it('should share the rows the others leave among the ones that fill, padded to their share', () => {
    // Arrange
    const stack = stackVertically([
      createTextElement('top'),
      { ...createTextElement('a'), fill: true },
      { ...createTextElement(['b', 'c', 'd', 'e']), fill: true },
      createTextElement('bottom'),
    ])

    // Act
    const { rows } = stack.render(10, 7)

    // Assert
    expect(rows).toEqual(['top', 'a', '', 'b', 'c', 'd', 'bottom'])
  })

  it('should leave out a child given as false or undefined', () => {
    // Act
    const { rows } = stackVertically([createTextElement('a'), false, undefined, createTextElement('b')]).render(10)

    // Assert
    expect(rows).toEqual(['a', 'b'])
  })

  it('should cut the top when too tall, keeping the bottom and its cursor', () => {
    // Arrange
    const stack = stackVertically([
      createTextElement(['1', '2', '3']),
      { ...createTextElement('content'), fill: true },
      createInputElement(EMPTY_EDITING, { placeholder: 'Ask' }),
    ])

    // Act
    const { rows, cursor } = stack.render(20, 2)

    // Assert
    expect(plain(rows)).toEqual(['3', '› Ask'])
    expect(cursor).toEqual({ row: 1, column: 2 })
  })

  it('should move the cursor down by the rows above it', () => {
    // Arrange
    const stack = stackVertically([
      createTextElement(['', 'title']),
      { ...createTextElement(''), fill: true },
      createInputElement(EMPTY_EDITING, { placeholder: 'Ask' }),
      createTextElement(''),
    ])

    // Act
    const { cursor } = stack.render(20, 10)

    // Assert
    expect(cursor).toEqual({ row: 8, column: 2 })
  })
})

describe('stackHorizontally', () => {
  it('should give the columns left to the children without a width, the separator between each two', () => {
    // Arrange
    const stack = stackHorizontally(
      [{ ...createTextElement(['tree', 'a.ts']), width: 6 }, createTextElement('chat'), createTextElement('chat')],
      { separator: '│' },
    )

    // Act
    const { rows } = stack.render(20)

    // Assert
    expect(rows).toEqual(['tree  │chat  │chat', 'a.ts  │      │'])
  })

  it('should cut the children on the right when they do not fit', () => {
    // Arrange
    const stack = stackHorizontally([
      { ...createTextElement('left'), width: 6 },
      { ...createTextElement('right'), width: 6 },
    ])

    // Act
    const { rows } = stack.render(9)

    // Assert
    expect(plain(rows)).toEqual(['left  ri…'])
  })

  it('should move the cursor right by the columns before it', () => {
    // Arrange
    const stack = stackHorizontally(
      [{ ...createTextElement('tree'), width: 6 }, createInputElement(EMPTY_EDITING, { placeholder: 'Ask' })],
      { separator: '│' },
    )

    // Act
    const { cursor } = stack.render(30, 3)

    // Assert
    expect(cursor).toEqual({ row: 0, column: 9 })
  })
})

describe('padElement', () => {
  it('should keep columns free on either side, and count them in its width', () => {
    // Arrange
    const padded = padElement({ ...createTextElement('abcdef'), fill: true, width: 4 }, { left: 1, right: 2 })

    // Act
    const { rows } = padded.render(6)

    // Assert
    expect(plain(rows)).toEqual([' ab…'])
    expect(padded.fill).toBe(true)
    expect(padded.width).toBe(7)
  })
})

describe('createFirstThatFitsElement', () => {
  it('should draw the first version that fits, and the last one cut when none does', () => {
    // Arrange
    const title = createFirstThatFitsElement(['a long title', 'short', 'tiny'])

    // Act
    const fitting = title.render(6).rows
    const cut = title.render(3).rows

    // Assert
    expect(fitting).toEqual(['short'])
    expect(plain(cut)).toEqual(['ti…'])
  })
})

describe('createRuleElement', () => {
  it('should keep as many labels as fit, from the first, and the rule its full width', () => {
    // Act
    const [rule] = plain(createRuleElement(['in 1.2k', 'cache 50%', 'x'.repeat(20)]).render(30).rows)

    // Assert
    expect(rule).toMatch(/─ in 1\.2k · cache 50% ─$/)
    expect(displayWidth(rule)).toBe(30)
  })

  it('should draw a plain rule when no label fits', () => {
    // Act
    const rows = plain(createRuleElement(['too long to fit']).render(10).rows)

    // Assert
    expect(rows).toEqual(['─'.repeat(10)])
  })
})

describe('createInputElement', () => {
  it('should show the placeholder while nothing is typed, with the cursor after the prompt', () => {
    // Act
    const { rows, cursor } = createInputElement(EMPTY_EDITING, { placeholder: 'Ask anything' }).render(20)

    // Assert
    expect(plain(rows)).toEqual(['› Ask anything'])
    expect(cursor).toEqual({ row: 0, column: 2 })
  })

  it('should scroll a long line sideways, keeping the cursor in view', () => {
    // Arrange
    const editing = { ...EMPTY_EDITING, before: `${'a'.repeat(50)}end`, after: 'more' }

    // Act
    const { rows, cursor } = createInputElement(editing, { placeholder: '' }).render(20)

    // Assert
    const [shown] = plain(rows)
    expect(shown.slice(0, cursor?.column)).toMatch(/aend$/)
    expect(displayWidth(shown)).toBeLessThanOrEqual(20)
  })

  it('should hide the cursor while muted', () => {
    // Act
    const { cursor } = createInputElement(EMPTY_EDITING, { placeholder: 'Ask', muted: true }).render(20)

    // Assert
    expect(cursor).toBeUndefined()
  })
})

describe('elements', () => {
  const leaf: fc.Arbitrary<Element> = fc.oneof(
    fc.string().map(text => createTextElement(text)),
    fc.string().map(text => createWrappedTextElement(text)),
    fc.array(fc.constantFrom('中文', 'a👍🏽', 'abc')).map(words => createTextElement(words.join(' '))),
  )
  const tree = fc.letrec<{ element: Element }>(tie => ({
    element: fc.oneof(
      { depthSize: 'small' },
      leaf,
      fc.array(tie('element')).map(children => stackVertically(children)),
      fc.array(fc.tuple(tie('element'), fc.option(fc.nat(10)))).map(children =>
        stackHorizontally(
          children.map(([child, width]) => (width === null ? child : { ...child, width })),
          {
            separator: '│',
          },
        ),
      ),
      fc.tuple(tie('element'), fc.nat(3), fc.nat(3)).map(([child, left, right]) => padElement(child, { left, right })),
      tie('element').map(child => ({ ...child, fill: true })),
    ),
  })).element

  it('should never draw wider than the width given, nor taller than the height', () => {
    fc.assert(
      fc.property(tree, fc.integer({ min: 1, max: 40 }), fc.nat(12), (element, width, height) => {
        // Act
        const { rows } = element.render(width, height)

        // Assert
        expect(rows.length).toBeLessThanOrEqual(height)
        for (const row of rows) {
          expect(displayWidth(row)).toBeLessThanOrEqual(width)
        }
      }),
    )
  })
})

// Helpers

function plain(rows: string[]): string[] {
  return rows.map(row => stripVTControlCharacters(row))
}
