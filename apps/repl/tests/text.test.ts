// Text cut to the columns it shows in: the end of a line, whole graphemes only, however long the text
import { describe, expect, it } from 'vitest'
import { tail, widthOf } from '../src/ui/paint/text.ts'

describe('tail', () => {
  it('should keep as much of the end as fits, without cutting a grapheme in two', () => {
    // Arrange: a family and two flags are one grapheme each, two columns wide
    const text = 'abc 中文 👨‍👩‍👧 🇨🇳🇺🇸'

    // Act
    const ends = [1, 2, 3, 4, 5, 6, 7, 8].map(width => tail(text, width))

    // Assert
    expect(ends).toEqual(['', '🇺🇸', '🇺🇸', '🇨🇳🇺🇸', ' 🇨🇳🇺🇸', ' 🇨🇳🇺🇸', '👨‍👩‍👧 🇨🇳🇺🇸', ' 👨‍👩‍👧 🇨🇳🇺🇸'])
  })

  it('should give the whole text when it fits, and the same end of a long one as of its last part', () => {
    // Arrange
    const end = 'and the 结尾 👨‍👩‍👧'
    const long = `${'pasted text, 中文 '.repeat(10_000)}${end}`

    // Act
    const [whole, cut] = [tail(end, 100), tail(long, widthOf(end))]

    // Assert
    expect(whole).toBe(end)
    expect(cut).toBe(end)
  })
})
