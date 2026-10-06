// A path shortened from its start, or with the home folder as ~; help
import { homedir } from 'node:os'
import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { abbreviateHomePath, formatHelpSections, leftTruncatedPaths } from '../src/layout.ts'

describe('leftTruncatedPaths', () => {
  it('should leave out the first folders one at a time, keeping the last', () => {
    // Act
    const paths = leftTruncatedPaths('~/projects/app/src')

    // Assert
    expect(paths).toEqual(['~/projects/app/src', '…/projects/app/src', '…/app/src', '…/src'])
  })
})

describe('abbreviateHomePath', () => {
  it('should write the home folder as ~, and leave a folder that only starts with its name', () => {
    // Arrange
    const home = homedir()

    // Act
    const inside = abbreviateHomePath(`${home}/projects/app`)
    const itself = abbreviateHomePath(home)
    const beside = abbreviateHomePath(`${home}-other/app`)

    // Assert
    expect(inside).toBe('~/projects/app')
    expect(itself).toBe('~')
    expect(beside).toBe(`${home}-other/app`)
  })
})

describe('formatHelpSections', () => {
  it('should line the keys up in one column across sections, and wrap text to the width', () => {
    // Act
    const help = stripVTControlCharacters(
      formatHelpSections(
        [
          {
            title: 'Keys',
            rows: [
              ['Enter', 'sends'],
              ['Shift+Tab', 'switches'],
            ],
          },
          { title: 'Tools', rows: 'read, edit, bash, grep' },
        ],
        16,
      ),
    )

    // Assert
    expect(help.split('\n')).toEqual([
      'Keys',
      '  Enter      sends',
      '  Shift+Tab  switches',
      'Tools',
      '  read, edit,',
      '  bash, grep',
    ])
  })
})
