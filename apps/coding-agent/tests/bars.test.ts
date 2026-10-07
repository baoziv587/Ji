// The bars: a title that gives up the workspace first, the keys that matter now, the usage as far as it fits, and an input line that keeps the cursor in view
import type { Element, Rendered } from '@ji.dev/tui'
import type { Bars } from '../src/ui/bars.ts'
import { stripVTControlCharacters } from 'node:util'
import { displayWidth, EMPTY_EDITING } from '@ji.dev/tui'
import { describe, expect, it } from 'vitest'
import { MENU_ROWS, viewOf } from '../src/ui/bars.ts'

const COLUMNS = 80
const ROWS = 12

/** The conversation's part, empty. */
const CONTENT: Element = { fill: true, render: () => ({ rows: [] }) }

describe('viewOf', () => {
  it('should give up the workspace before the model, its first folders first', () => {
    // Arrange
    const root = '~/projects/pi-rsi/apps/coding-agent'

    // Act
    const wide = titleOf(COLUMNS, { root })
    const narrower = titleOf(60, { root })
    const narrow = titleOf(42, { root })
    const narrowest = titleOf(35, { root })

    // Assert
    expect(wide).toBe(`ji · deepseek/deepseek-flash · high · ${root}`)
    expect(narrower).toBe('ji · deepseek/deepseek-flash · high · …/apps/coding-agent')
    expect(narrow).toBe('ji · deepseek/deepseek-flash · high')
    expect(narrowest).toBe('ji · deepseek-flash · high')
  })

  it('should list only the keys that matter now', () => {
    // Act
    const idle = statusOf({})
    const replying = statusOf({ replying: true })
    const asking = statusOf({ replying: true, asking: true })

    // Assert
    expect(idle).toMatch(/Ctrl\+O details · Shift\+Tab switches · \/exit quits$/)
    expect(replying).toMatch(/Enter steers · Ctrl\+C stops$/)
    expect(asking).toMatch(/· Ctrl\+C stops$/)
    expect(asking).not.toContain('Enter')
  })

  it('should show the usage under the input line, leaving out what does not fit from the end', () => {
    // Arrange
    const usage = ['ctx 4.2k/200k', 'in 1.2k · out 300', 'cache 50%', `${'x'.repeat(COLUMNS)} tok/s`]

    // Act
    const rows = drawn(COLUMNS, { usage }).rows.map(row => stripVTControlCharacters(row))

    // Assert
    expect(rows.at(-2)!.trimEnd()).toBe(' ctx 4.2k/200k   in 1.2k · out 300 · cache 50%')
    expect(rows.at(-3)!.trim()).toBe('')
    expect(rows.at(-4)).toContain('Ask anything')
    expect(rows.at(-6)).toBe('─'.repeat(COLUMNS))
    expect(rows.at(-1)!.trim()).toBe('')
  })

  it('should scroll a long input sideways, keeping the cursor in view', () => {
    // Arrange
    const editing = { ...EMPTY_EDITING, before: `${'a'.repeat(200)}end` }

    // Act
    const screen = drawn(COLUMNS, { editing })
    const input = stripVTControlCharacters(screen.rows.at(-4)!)

    // Assert
    expect(input).toMatch(/aend$/)
    expect(displayWidth(input)).toBeLessThan(COLUMNS)
    expect(screen.cursor).toEqual({ row: ROWS - 4, column: displayWidth(input) })
  })

  it('should show the commands menu above the input, with its own keys', () => {
    // Arrange
    const menu = { items: [['/help', 'lists this'] as [string, string]], selected: 0 }

    // Act
    const screen = drawn(COLUMNS, { menu })
    const rows = screen.rows.map(row => stripVTControlCharacters(row))

    // Assert
    expect(rows.at(-5)).toBe(' ❯ /help  lists this')
    expect(rows.at(-6)).toMatch(/↑↓ choose · Tab completes · Enter runs · Esc closes$/)
  })

  it('should keep the menu to a few rows with the chosen one in view, and say which of them it is', () => {
    // Arrange
    const items = Array.from({ length: 20 }, (_, i): [string, string] => [`/skill${i}`, 'does something'])

    // Act
    const screen = viewOf(bars({ menu: { items, selected: 12 } }), CONTENT).render(COLUMNS, 30)
    const rows = screen.rows.map(row => stripVTControlCharacters(row))
    const menuRows = rows.slice(-4 - MENU_ROWS, -4)

    // Assert
    expect(menuRows.every(row => row.includes('/skill'))).toBe(true)
    expect(rows.at(-5 - MENU_ROWS)).toMatch(/13 of 20 · ↑↓ choose/)
    expect(menuRows.filter(row => row.startsWith(' ❯'))).toEqual([' ❯ /skill12  does something'])
  })

  it('should give the conversation the rows the bars leave', () => {
    // Arrange
    const given: (number | undefined)[] = []
    const content: Element = {
      fill: true,
      render: (_, height) => {
        given.push(height)
        return { rows: [] }
      },
    }

    // Act
    const screen = viewOf(bars({}), content).render(COLUMNS, ROWS)

    // Assert
    expect(given).toEqual([ROWS - 9])
    expect(screen.rows).toHaveLength(ROWS)
  })
})

// Helpers

function bars(changes: Partial<Bars>): Bars {
  return {
    model: 'deepseek/deepseek-flash',
    thinking: 'high',
    root: '/work',
    editing: EMPTY_EDITING,
    replying: false,
    asking: false,
    queued: 0,
    usage: [],
    status: '',
    view: 'brief',
    below: 0,
    mode: 'ask',
    auto: false,
    allowed: '',
    ...changes,
  }
}

function drawn(columns: number, changes: Partial<Bars>): Rendered {
  return viewOf(bars(changes), CONTENT).render(columns, ROWS)
}

function titleOf(columns: number, changes: Partial<Bars>): string {
  return stripVTControlCharacters(drawn(columns, changes).rows[1]).trim()
}

function statusOf(changes: Partial<Bars>): string {
  return stripVTControlCharacters(drawn(COLUMNS, changes).rows.at(-5)!)
}
