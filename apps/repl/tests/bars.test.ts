// The bars: the keys that matter now, the usage as far as it fits, and an input line that keeps the cursor in view
import type { Bars } from '../src/ui/screen/bars.ts'
import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { widthOf } from '../src/ui/paint/text.ts'
import { frameOf } from '../src/ui/screen/bars.ts'
import { EMPTY } from '../src/ui/screen/editing.ts'

const COLUMNS = 80

describe('frameOf', () => {
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
    expect(widthOf(rule)).toBe(COLUMNS - 1)
  })

  it('should scroll a long input sideways, keeping the cursor in view', () => {
    // Arrange
    const editing = { ...EMPTY, before: `${'a'.repeat(200)}end` }

    // Act
    const frame = frameOf(COLUMNS, bars({ editing }))
    const input = stripVTControlCharacters(frame.bottom[2])

    // Assert
    expect(input).toMatch(/aend$/)
    expect(widthOf(input)).toBeLessThan(COLUMNS)
    expect(frame.cursor).toEqual({ row: 2, column: widthOf(input) })
  })
})

// Helpers

function bars(changes: Partial<Bars>): Bars {
  return {
    model: 'deepseek/deepseek-v4-flash',
    thinking: 'high',
    root: '/work',
    editing: EMPTY,
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

function statusOf(changes: Partial<Bars>): string {
  return stripVTControlCharacters(frameOf(COLUMNS, bars(changes)).bottom[1])
}
