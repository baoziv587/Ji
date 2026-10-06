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
    expect(wide).toBe(`ji · deepseek/deepseek-v4-flash · high · ${root}`)
    expect(narrower).toBe('ji · deepseek/deepseek-v4-flash · high · …/coding-agent')
    expect(narrow).toBe('ji · deepseek/deepseek-v4-flash · high')
    expect(narrowest).toBe('ji · deepseek-v4-flash · high')
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

  it('should show the mode, what a yes allowed and the steers not yet delivered', () => {
    // Act
    const status = statusOf({ mode: 'auto', auto: true, allowed: 'allows commands', queued: 2 })

    // Assert
    expect(status).toContain('auto · allows commands · 2 queued')
  })

  it('should leave out the usage that does not fit, from the end', () => {
    // Arrange
    const usage = ['in 1.2k · out 300', 'cache 50%', `${'x'.repeat(60)} tok/s`]

    // Act
    const rule = stripVTControlCharacters(drawn(COLUMNS, { usage }).rows.at(-4)!)

    // Assert
    expect(rule).toContain('in 1.2k · out 300 · cache 50% ─')
    expect(rule).not.toContain('tok/s')
    expect(displayWidth(rule)).toBe(COLUMNS)
  })

  it('should scroll a long input sideways, keeping the cursor in view', () => {
    // Arrange
    const editing = { ...EMPTY_EDITING, before: `${'a'.repeat(200)}end` }

    // Act
    const screen = drawn(COLUMNS, { editing })
    const input = stripVTControlCharacters(screen.rows.at(-2)!)

    // Assert
    expect(input).toMatch(/aend$/)
    expect(displayWidth(input)).toBeLessThan(COLUMNS)
    expect(screen.cursor).toEqual({ row: ROWS - 2, column: displayWidth(input) })
  })

  it('should show the commands menu above the input, with its own keys', () => {
    // Arrange
    const menu = { items: [['/help', 'lists this'] as [string, string]], selected: 0 }

    // Act
    const screen = drawn(COLUMNS, { menu })
    const rows = screen.rows.map(row => stripVTControlCharacters(row))

    // Assert
    expect(rows.at(-3)).toBe(' ❯ /help  lists this')
    expect(rows.at(-4)).toMatch(/↑↓ choose · Tab completes · Enter runs · Esc closes$/)
  })

  it('should keep the menu to a few rows with the chosen one in view, and say which of them it is', () => {
    // Arrange
    const items = Array.from({ length: 20 }, (_, i): [string, string] => [`/skill${i}`, 'does something'])

    // Act
    const screen = viewOf(bars({ menu: { items, selected: 12 } }), CONTENT).render(COLUMNS, 30)
    const rows = screen.rows.map(row => stripVTControlCharacters(row))
    const menuRows = rows.slice(-2 - MENU_ROWS, -2)

    // Assert
    expect(menuRows.every(row => row.includes('/skill'))).toBe(true)
    expect(rows.at(-3 - MENU_ROWS)).toMatch(/13 of 20 · ↑↓ choose/)
    expect(menuRows.filter(row => row.startsWith(' ❯'))).toEqual([' ❯ /skill12  does something'])
  })

  it('should hide the cursor while a question is open', () => {
    // Act
    const screen = drawn(COLUMNS, { replying: true, asking: true })

    // Assert
    expect(screen.cursor).toBeUndefined()
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
    expect(given).toEqual([ROWS - 7])
    expect(screen.rows).toHaveLength(ROWS)
  })
})

// Helpers

function bars(changes: Partial<Bars>): Bars {
  return {
    model: 'deepseek/deepseek-v4-flash',
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
  return stripVTControlCharacters(drawn(COLUMNS, changes).rows.at(-3)!)
}
