// The bars: a title that gives up the workspace first, the keys that matter now, the usage as far as it fits, and an input line that keeps the cursor in view
import type { Bars } from '../src/ui/bars.ts'
import { stripVTControlCharacters } from 'node:util'
import { displayWidth, EMPTY_EDITING } from '@ji.dev/tui'
import { describe, expect, it } from 'vitest'
import { frameOf } from '../src/ui/bars.ts'

const COLUMNS = 80

describe('frameOf', () => {
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
    const status = statusOf({ mode: 'auto: approves', auto: true, allowed: 'allows every command', queued: 2 })

    // Assert
    expect(status).toContain('auto: approves · allows every command · 2 queued')
  })

  it('should leave out the usage that does not fit, from the end', () => {
    // Arrange
    const usage = ['in 1.2k · out 300', 'cache 50%', `${'x'.repeat(60)} tok/s`]

    // Act
    const [rule] = frameOf(COLUMNS, bars({ usage })).bottom.map(line => stripVTControlCharacters(line))

    // Assert
    expect(rule).toContain('in 1.2k · out 300 · cache 50% ─')
    expect(rule).not.toContain('tok/s')
    expect(displayWidth(rule)).toBe(COLUMNS - 1)
  })

  it('should scroll a long input sideways, keeping the cursor in view', () => {
    // Arrange
    const editing = { ...EMPTY_EDITING, before: `${'a'.repeat(200)}end` }

    // Act
    const frame = frameOf(COLUMNS, bars({ editing }))
    const input = stripVTControlCharacters(frame.bottom[2])

    // Assert
    expect(input).toMatch(/aend$/)
    expect(displayWidth(input)).toBeLessThan(COLUMNS)
    expect(frame.cursor).toEqual({ row: 2, column: displayWidth(input) })
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

function titleOf(columns: number, changes: Partial<Bars>): string {
  return stripVTControlCharacters(frameOf(columns, bars(changes)).top[1]).trim()
}

function statusOf(changes: Partial<Bars>): string {
  return stripVTControlCharacters(frameOf(COLUMNS, bars(changes)).bottom[1])
}
