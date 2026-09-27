// pluginStateSlot is where a plugin reads and writes its own data (plugin.select and the state reducer).
// Guarantee 4 (hot swap keeps plugin state reliable) rests on these three rules. pluginsOf is how a nested plugin
// list is registered (RFC-0006 §6.1, appendix A.1).
import type { AnyPlugin, PluginList } from './plugin.ts'
import type { AgentState } from './types.ts'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { user } from './message.ts'
import { definePlugin, pluginsOf, pluginStateSlot } from './plugin.ts'

// A small pool of real objects, so the same index is the same object (appendix A.1: identity, not structure)
const pool = Array.from({ length: 4 }, (_, i) => definePlugin({ name: `p${i}` }))

const nestedList: fc.Arbitrary<PluginList> = fc.letrec<{ list: PluginList; item: AnyPlugin | PluginList }>(tie => ({
  list: fc.array(tie('item'), { maxLength: 4 }),
  item: fc.oneof({ depthSize: 'small' }, fc.constantFrom(...pool), tie('list')),
})).list

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

describe('pluginStateSlot writes', () => {
  it('should always read back what was written and leave the other slots and messages alone', () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.jsonValue(), (value, other) => {
        // Arrange
        const counter = pluginStateSlot<unknown>('counter', null)
        const state: AgentState = { messages: [user('hi')], plugins: { other } }

        // Act
        const updated = counter.set(state, value)

        // Assert
        expect(counter.get(updated)).toEqual(value)
        expect(updated.plugins.other).toBe(other)
        expect(updated.messages).toBe(state.messages)
        expect(state.plugins).toEqual({ other })
      }),
    )
  })
})

describe('pluginsOf', () => {
  it('should always keep each object once, where it first appears, however the list nests', () => {
    fc.assert(
      fc.property(nestedList, list => {
        // Act
        const registered = pluginsOf(list)

        // Assert
        const flat = flatten(list)
        expect(registered).toEqual(flat.filter((p, i) => flat.indexOf(p) === i))
        expect(pluginsOf(registered)).toEqual(registered)
        expect(pluginsOf([list, list])).toEqual(registered)
      }),
    )
  })

  it('should tell apart two objects with the same name, and keep list order', () => {
    // Arrange
    const [a, b] = [definePlugin({ name: 'same' }), definePlugin({ name: 'same' })]

    // Act
    const ab = pluginsOf([a, [b, a]])
    const ba = pluginsOf([b, a])

    // Assert
    expect(ab).toEqual([a, b])
    expect(ab[0]).toBe(a)
    expect(ba[0]).toBe(b)
  })
})

function flatten(list: PluginList): AnyPlugin[] {
  return list.flatMap(item => (Array.isArray(item) ? flatten(item) : [item as AnyPlugin]))
}
