// The commands menu: what is typed found in names first, then in hints, and underlined where it was found
import type { Editing } from '@ji.dev/tui'
import process from 'node:process'
import { stripVTControlCharacters } from 'node:util'
import { EMPTY_EDITING } from '@ji.dev/tui'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CommandMenu } from '../src/ui/menu.ts'

const COMMANDS = [
  { name: '/think', hint: 'sets thinking', run: () => {} },
  { name: '/help', hint: 'lists keys, commands and tools', run: () => {} },
  { name: '/reload-skills', hint: 'reads ~/.agents/skills again', run: () => {} },
  { name: '/apple-HIG', hint: 'Design, review, or critique interaction flows for iOS/macOS apps.', group: 'Skills' },
  { name: '/design-a-logo', arg: '[brief]', hint: '为个人、团队设计 Logo。', group: 'Skills' },
]

/** styleText styles only for a terminal that shows colors; the tests are not run in one. */
let forced: string | undefined

beforeEach(() => {
  forced = process.env.FORCE_COLOR
  process.env.FORCE_COLOR = '1'
})

afterEach(() => {
  if (forced === undefined) {
    delete process.env.FORCE_COLOR
  } else {
    process.env.FORCE_COLOR = forced
  }
})

describe('commandMenu', () => {
  it('should put names starting with what is typed first, then names having it, then hints having it', () => {
    // Arrange
    const menu = new CommandMenu(() => COMMANDS)

    // Act
    const names = namesOf(menu, '/des')

    // Assert: /design-a-logo starts with it, /apple-HIG has it in the hint (Design), /think has it nowhere
    expect(names).toEqual(['/design-a-logo', '/apple-HIG'])
  })

  it('should find a name by a part of it, case aside, ahead of a hint', () => {
    // Arrange
    const menu = new CommandMenu(() => COMMANDS)

    // Act
    const byPart = namesOf(menu, '/hig')
    const byHint = namesOf(menu, '/Thinking')
    const everything = namesOf(menu, '/')

    // Assert
    expect(byPart).toEqual(['/apple-HIG'])
    expect(byHint).toEqual(['/think'])
    expect(everything).toEqual(COMMANDS.map(c => c.name))
  })

  it('should underline what is typed where it was found, in the name and the hint alike', () => {
    // Arrange
    const menu = new CommandMenu(() => COMMANDS)

    // Act
    const items = menu.view(typing('/des'))?.items ?? []
    const [logoName, logoAction] = items[0]
    const [higName, higAction] = items[1]

    // Assert
    expect(logoName).toBe(`/${underline('des')}ign-a-logo`)
    expect(stripVTControlCharacters(logoAction)).toBe('[brief]  为个人、团队设计 Logo。')
    expect(logoAction).not.toContain('\x1B[4m')
    expect(higName).toBe('/apple-HIG')
    expect(higAction).toBe(`${underline('Des')}ign, review, or critique interaction flows for iOS/macOS apps.`)
  })

  it('should show nothing underlined and everything listed for a bare slash', () => {
    // Arrange
    const menu = new CommandMenu(() => COMMANDS)

    // Act
    const items = menu.view(typing('/'))?.items ?? []

    // Assert
    expect(items.map(([key]) => key)).toEqual(COMMANDS.map(c => c.name))
    expect(items.flat().some(text => text.includes('\x1B[4m'))).toBe(false)
  })
})

// Helpers

function typing(text: string): Editing {
  return { ...EMPTY_EDITING, before: text }
}

function namesOf(menu: CommandMenu, text: string): string[] {
  return (menu.view(typing(text))?.items ?? []).map(([key]) => stripVTControlCharacters(key))
}

function underline(text: string): string {
  return `\x1B[4m${text}\x1B[24m`
}
