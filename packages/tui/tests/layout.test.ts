// Fitting a line to its width: the first version that fits, a path shortened from its start, a rule with labels, help
import { homedir } from 'node:os'
import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import {
  abbreviateHomePath,
  drawRuleWithLabels,
  formatHelpSections,
  leftTruncatedPaths,
  pickFirstThatFits,
} from '../src/layout.ts'
import { displayWidth } from '../src/text.ts'

describe('pickFirstThatFits', () => {
  it('should give the first line that fits, and none when none does', () => {
    // Arrange
    const lines = ['a long line', 'short', 'x']

    // Act
    const fitting = pickFirstThatFits(5, lines)
    const none = pickFirstThatFits(0, lines)

    // Assert
    expect(fitting).toBe('short')
    expect(none).toBeUndefined()
  })
})

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

describe('drawRuleWithLabels', () => {
  it('should keep as many labels as fit, from the first, and the rule its full width', () => {
    // Act
    const rule = stripVTControlCharacters(drawRuleWithLabels(30, ['in 1.2k', 'cache 50%', 'x'.repeat(20)]))

    // Assert
    expect(rule).toMatch(/─ in 1\.2k · cache 50% ─$/)
    expect(displayWidth(rule)).toBe(30)
  })

  it('should draw a plain rule when no label fits', () => {
    // Act
    const rule = stripVTControlCharacters(drawRuleWithLabels(10, ['too long to fit']))

    // Assert
    expect(rule).toBe('─'.repeat(10))
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
