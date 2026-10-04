// prepare and commit: a failed check never publishes (L5); outcomes and what the model reads
import type { Edit, Store } from '../src/index.ts'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { commit, diff, editTransform, memStore, prepare, writeTransform } from '../src/index.ts'
import { render } from '../src/render.ts'

const signal = new AbortController().signal
const PATH = '/w/src/config.ts'
const CONFIG = 'export const config = {\n  name: "app",\n  timeout: 1000,\n  retries: 2,\n}\n'

describe('commit', () => {
  it('should never publish when a check fails (L5)', async () => {
    const edit = fc.record({
      old_text: fc.string({ unit: fc.constantFrom('a', 'b', '\n'), maxLength: 3 }),
      new_text: fc.string({ unit: fc.constantFrom('a', 'x'), maxLength: 2 }),
    })
    await fc.assert(
      fc.asyncProperty(
        fc.string({ unit: fc.constantFrom('a', 'b', '\n'), maxLength: 12 }),
        fc.array(edit, { maxLength: 3 }),
        async (text, edits) => {
          // Arrange
          const { store, publishes } = spied(memStore({ [PATH]: text }))
          const { version } = (await store.read(PATH, signal))!

          // Act
          const outcome = await commit(store, PATH, version, editTransform(edits), signal)

          // Assert
          expect(publishes()).toBe(outcome.state === 'applied' ? 1 : 0)
        },
      ),
    )
  })

  it('should apply two edits to the same original file and report both (scenario 2.2)', async () => {
    // Arrange
    const store = memStore({ [PATH]: CONFIG })
    const { version } = (await store.read(PATH, signal))!
    const edits: Edit[] = [
      { old_text: 'timeout: 1000,', new_text: 'timeout: 2000,' },
      { old_text: 'retries: 2,', new_text: 'retries: 3,' },
    ]

    // Act
    const outcome = await commit(store, PATH, version, editTransform(edits), signal)

    // Assert
    expect(store.get(PATH)).toBe(CONFIG.replace('1000', '2000').replace('retries: 2', 'retries: 3'))
    expect(render(outcome, 'src/config.ts', 'edit')).toMatchObject({
      isError: false,
      text: [
        'Edited src/config.ts (2 replacements).',
        '@@ -3,2 +3,2 @@',
        '-  timeout: 1000,',
        '-  retries: 2,',
        '+  timeout: 2000,',
        '+  retries: 3,',
      ].join('\n'),
      details: { commit_state: 'applied', replacements: 2, lines: [3, 4], version_before: version },
    })
  })

  it('should reject a stale version and an edit that changes nothing, without writing', async () => {
    // Arrange
    const store = memStore({ [PATH]: CONFIG })
    const { version } = (await store.read(PATH, signal))!
    store.set(PATH, `// edited elsewhere\n${CONFIG}`)
    const { version: current } = (await store.read(PATH, signal))!

    // Act
    const stale = await commit(store, PATH, version, editTransform([{ old_text: 'app', new_text: 'web' }]), signal)
    const same = await commit(store, PATH, current, editTransform([{ old_text: 'app', new_text: 'app' }]), signal)

    // Assert
    expect(stale).toEqual({ state: 'not_applied', errors: [{ code: 'STALE_VERSION', expected: version, current }] })
    expect(same).toEqual({ state: 'not_applied', errors: [{ code: 'NO_CHANGE' }] })
    expect(render(stale, 'src/config.ts', 'edit').text).toBe(
      'Edit failed; src/config.ts is unchanged.\nThe file changed after you last read it. Read it again before editing.',
    )
  })

  it('should create a file only when it is absent, and refuse to replace one it was not told about', async () => {
    // Arrange
    const store = memStore({ [PATH]: CONFIG })

    // Act
    const created = await commit(store, '/w/src/new.ts', 'absent', writeTransform('a\nb\n'), signal)
    const clobber = await commit(store, PATH, 'absent', writeTransform('oops'), signal)

    // Assert
    expect(render(created, 'src/new.ts', 'write').text).toBe('Created src/new.ts (2 lines).')
    expect(render(clobber, 'src/config.ts', 'write').text).toContain('src/config.ts already exists.')
    expect(store.get(PATH)).toBe(CONFIG)
  })

  it('should say a write may have happened when the store cannot tell', async () => {
    // Arrange
    const mem = memStore({ [PATH]: CONFIG })
    const store: Store = {
      read: mem.read,
      publish: async () => ({ state: 'unknown', error: new Error('connection reset') }),
    }
    const { version } = (await store.read(PATH, signal))!

    // Act
    const outcome = await commit(store, PATH, version, editTransform([{ old_text: 'app', new_text: 'web' }]), signal)

    // Assert
    expect(render(outcome, 'src/config.ts', 'edit')).toMatchObject({
      isError: true,
      details: { commit_state: 'unknown' },
      text: expect.stringContaining('may or may not have happened'),
    })
  })
})

describe('prepare', () => {
  it('should give the diff without writing (scenario 2.10)', async () => {
    // Arrange
    const store = memStore({ [PATH]: CONFIG })
    const { version } = (await store.read(PATH, signal))!

    // Act
    const prepared = await prepare(
      store,
      PATH,
      version,
      editTransform([{ old_text: '"app"', new_text: '"web"' }]),
      signal,
    )

    // Assert
    expect(prepared.ok && diff(prepared.value)).toBe('@@ -2,1 +2,1 @@\n-  name: "app",\n+  name: "web",')
    expect(store.get(PATH)).toBe(CONFIG)
  })

  it('should put replacements on one line in one hunk, and number later hunks in the new file', async () => {
    // Arrange
    const store = memStore({ [PATH]: 'a b\nc\nd\n' })
    const { version } = (await store.read(PATH, signal))!
    const edits: Edit[] = [
      { old_text: 'a', new_text: 'x' },
      { old_text: 'b', new_text: 'y\nz' },
      { old_text: 'd', new_text: 'w' },
    ]

    // Act
    const prepared = await prepare(store, PATH, version, editTransform(edits), signal)

    // Assert
    expect(prepared.ok && diff(prepared.value)).toBe('@@ -1,1 +1,2 @@\n-a b\n+x y\n+z\n@@ -3,1 +4,1 @@\n-d\n+w')
  })
})

// Helpers

function spied(store: Store): { store: Store; publishes: () => number } {
  let n = 0
  return {
    store: {
      read: store.read,
      publish: async (...args) => {
        n++
        return store.publish(...args)
      },
    },
    publishes: () => n,
  }
}
