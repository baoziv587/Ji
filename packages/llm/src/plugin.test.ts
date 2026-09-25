// pluginStateSlot is where a plugin reads and writes its own data (plugin.select and the state reducer).
// Guarantee 4 (hot swap keeps plugin state reliable) rests on these three rules.
import type { AgentState } from './types.ts'
import { describe, expect, it } from 'vitest'
import { user } from './message.ts'
import { definePlugin, pluginStateSlot } from './plugin.ts'

const slot = pluginStateSlot('counter', 0)
const empty: AgentState = { messages: [], plugins: {} }
const filled: AgentState = { messages: [user('hi')], plugins: { counter: 3, other: 'kept' } }

describe('pluginStateSlot', () => {
  it('set-get: reads back what was written', () => {
    expect(slot.get(slot.set(filled, 5))).toBe(5)
    expect(slot.get(slot.set(empty, 5))).toBe(5)
  })

  it('set-set: the second write wins', () => {
    expect(slot.set(slot.set(filled, 5), 6)).toEqual(slot.set(filled, 6))
  })

  it('get-set: writing back what was read changes nothing', () => {
    expect(slot.set(filled, slot.get(filled))).toEqual(filled)
    expect(slot.get(slot.set(empty, slot.get(empty)))).toBe(slot.get(empty))
  })

  it('returns init for an empty slot and leaves messages and other slots untouched', () => {
    expect(slot.get(empty)).toBe(0)

    const written = slot.set(filled, 9)
    expect(written.messages).toBe(filled.messages)
    expect(written.plugins.other).toBe('kept')
  })

  it('is what plugin.select reads', () => {
    const counter = definePlugin({ name: 'counter', state: { init: 0, reduce: n => n + 1 } })
    expect(counter.select(filled)).toBe(3)
    expect(counter.select(empty)).toBe(0)
  })
})
