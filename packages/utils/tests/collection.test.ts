import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { duplicatesBy } from '../src/collection.ts'

describe('duplicatesBy', () => {
  it('should list each key shared by distinct items once, in order of first appearance', () => {
    // Arrange
    const items = [{ name: 'b' }, { name: 'a' }, { name: 'b' }, { name: 'a' }, { name: 'a' }, { name: 'c' }]

    // Act
    const duplicates = duplicatesBy(items, item => item.name)

    // Assert
    expect(duplicates).toEqual(['b', 'a'])
  })

  it('should not count the same item listed twice', () => {
    // Arrange
    const item = { name: 'a' }

    // Act
    const duplicates = duplicatesBy([item, item], i => i.name)

    // Assert
    expect(duplicates).toEqual([])
  })

  it('should always find nothing among items with distinct keys', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.string()), names => {
        expect(
          duplicatesBy(
            names.map(name => ({ name })),
            item => item.name,
          ),
        ).toEqual([])
      }),
    )
  })
})
