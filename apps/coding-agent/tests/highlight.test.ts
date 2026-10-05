// Code in color: which language a fence or a path names, and how a line is painted
import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { highlight, languageOf, loadLanguage } from '../src/ui/paint/highlight.ts'

describe('languageOf', () => {
  it('should know a fence by its first word, and a path by its name or else its extension', () => {
    // Act
    const names = ['ts', 'tsx title="a.tsx"', 'src/a.test.ts', 'docker/Dockerfile', '', 'notes.unknown', 'constructor']

    // Assert
    expect(names.map(languageOf)).toEqual(['ts', 'tsx', 'ts', 'dockerfile', undefined, undefined, undefined])
  })
})

describe('highlight', () => {
  it('should keep the text as it is, only in color', async () => {
    // Arrange
    const code = 'const a = 1\n\nlet b = "x"'

    // Act
    const lines = await highlight(code, 'ts')

    // Assert
    expect(lines.map(line => stripVTControlCharacters(line))).toEqual(code.split('\n'))
    expect(lines[0]).not.toBe('const a = 1')
  })

  it('should paint a line in the state the lines before it left', async () => {
    // Arrange: the second line is inside a string the first one opened
    const paint = (await loadLanguage('ts'))()
    const alone = (await loadLanguage('ts'))()

    // Act
    paint('const a = `x')
    const inString = paint('if')
    const asCode = alone('if')

    // Assert
    expect(inString).not.toBe(asCode)
  })

  it('should put a later background over an earlier one, and plain text on its backgrounds only', async () => {
    // Arrange
    const paint = (await loadLanguage(undefined))()

    // Act
    const line = paint('abcd', [
      { start: 0, end: 4, color: '#000001' },
      { start: 1, end: 3, color: '#000002' },
    ])

    // Assert
    expect(line).toBe('\x1B[48;2;0;0;1ma\x1B[0m\x1B[48;2;0;0;2mbc\x1B[0m\x1B[48;2;0;0;1md\x1B[0m')
  })
})
