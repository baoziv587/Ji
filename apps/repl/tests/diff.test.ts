// A diff in color: the same text, with what a line changed on a stronger background
import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { paintDiff } from '../src/diff.ts'
import { DIFF, loadLanguage } from '../src/highlight.ts'

describe('paintDiff', () => {
  it('should keep every line of every hunk as it is, only in color', async () => {
    // Arrange
    const patch = '@@ -1,1 +1,1 @@\n-const a = 1\n+const a = 2\n@@ -9,0 +9,1 @@\n+// new'

    // Act
    const painted = paintDiff(patch, await loadLanguage('ts'))

    // Assert
    expect(stripVTControlCharacters(painted)).toBe(patch)
  })

  it('should put only what a replaced line changed on the stronger background', async () => {
    // Arrange: plain text, so only the backgrounds color it
    const patch = '@@ -1,1 +1,1 @@\n-abcd\n+aXYd'

    // Act
    const [, removed, added] = paintDiff(patch, await loadLanguage(undefined)).split('\n')

    // Assert
    expect(textOn(removed, DIFF.removed.changed)).toBe('bc')
    expect(textOn(added, DIFF.added.changed)).toBe('XY')
  })
})

// Helpers

/** The text painted on `color` as a background. */
function textOn(line: string, color: string): string {
  const rgb = [1, 3, 5].map(i => Number.parseInt(color.slice(i, i + 2), 16)).join(';')
  const painted = line.match(new RegExp(`48;2;${rgb}m([^\\x1B]*)`, 'g')) ?? []
  return painted.map(part => stripVTControlCharacters(part.slice(part.indexOf('m') + 1))).join('')
}
