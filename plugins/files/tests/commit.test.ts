// prepare and commit: a failed check never publishes (L5), transforms compose (L4), and what the model reads
import type { Edit, Transform, Workspace } from '../src/index.ts'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  chain,
  commit,
  defaultHinters,
  diff,
  editTransform,
  err,
  FileError,
  memWorkspace,
  ok,
  prepare,
  writeTransform,
} from '../src/index.ts'
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
          const { workspace, publishes } = spied(memWorkspace({ [PATH]: text }))
          const { version } = (await workspace.read(PATH, signal))!

          // Act
          const result = await commit(workspace, PATH, version, editTransform(edits), signal)

          // Assert
          expect(publishes()).toBe(result.ok ? 1 : 0)
        },
      ),
    )
  })

  it('should apply two edits to the same original file and report both (scenario 2.2)', async () => {
    // Arrange
    const workspace = memWorkspace({ [PATH]: CONFIG })
    const { version } = (await workspace.read(PATH, signal))!
    const edits: Edit[] = [
      { old_text: 'timeout: 1000,', new_text: 'timeout: 2000,' },
      { old_text: 'retries: 2,', new_text: 'retries: 3,' },
    ]

    // Act
    const result = await commit(workspace, PATH, version, editTransform(edits), signal)

    // Assert
    const written = (await workspace.read(PATH, signal))!.version
    expect(workspace.get(PATH)).toBe(CONFIG.replace('1000', '2000').replace('retries: 2', 'retries: 3'))
    expect(render(result, 'src/config.ts')).toEqual({
      isError: false,
      text: [
        'Edited src/config.ts (+2 -2).',
        '@@ -3,2 +3,2 @@',
        '-  timeout: 1000,',
        '-  retries: 2,',
        '+  timeout: 2000,',
        '+  retries: 3,',
      ].join('\n'),
      details: { path: PATH, version: written },
    })
  })

  it('should reject a stale version and a change that changes nothing, without writing', async () => {
    // Arrange
    const workspace = memWorkspace({ [PATH]: CONFIG })
    const { version } = (await workspace.read(PATH, signal))!
    workspace.set(PATH, `// edited elsewhere\n${CONFIG}`)
    const { version: current } = (await workspace.read(PATH, signal))!

    // Act
    const stale = await commit(workspace, PATH, version, editTransform([{ old_text: 'app', new_text: 'web' }]), signal)
    const same = await commit(workspace, PATH, current, editTransform([{ old_text: 'app', new_text: 'app' }]), signal)

    // Assert
    expect(stale).toEqual(err([{ code: 'STALE_VERSION', expected: version, current }]))
    expect(same).toEqual(err([{ code: 'NO_CHANGE' }]))
    expect(render(stale, 'src/config.ts').text).toBe(
      'Edit failed; src/config.ts is unchanged.\nThe file is not at the version you last read: it changed, or an earlier write of yours went through. Read it again before changing it.',
    )
  })

  it('should create a file only when it is absent, and refuse to replace one it was not told about', async () => {
    // Arrange
    const workspace = memWorkspace({ [PATH]: CONFIG })

    // Act
    const created = await commit(workspace, '/w/src/new.ts', 'absent', writeTransform('a\nb\n'), signal)
    const clobber = await commit(workspace, PATH, 'absent', writeTransform('oops'), signal)

    // Assert
    expect(render(created, 'src/new.ts').text).toBe('Created src/new.ts (2 lines).')
    expect(render(clobber, 'src/config.ts').text).toContain('src/config.ts exists and you have not read it.')
    expect(workspace.get(PATH)).toBe(CONFIG)
  })

  it('should write once when a publish went through but its response was lost and the commit is retried', async () => {
    // Arrange
    const mem = memWorkspace({ [PATH]: CONFIG })
    const workspace: Workspace = {
      ...mem,
      publish: async (...args) => {
        await mem.publish(...args)
        throw new Error('connection reset')
      },
    }
    const { version } = (await workspace.read(PATH, signal))!
    const change = editTransform([{ old_text: 'app', new_text: 'web' }])

    // Act
    const lost = commit(workspace, PATH, version, change, signal)
    await expect(lost).rejects.toThrow('connection reset')
    const retried = await commit(workspace, PATH, version, change, signal)

    // Assert
    expect(retried).toMatchObject(err([{ code: 'STALE_VERSION', expected: version }]))
    expect(mem.get(PATH)).toBe(CONFIG.replace('app', 'web'))
  })

  it('should report a path the workspace refuses as a result, and rethrow any other failure', async () => {
    // Arrange
    const mem = memWorkspace({ [PATH]: CONFIG })
    const denied: Workspace = {
      ...mem,
      resolve: async path => {
        throw new FileError('PATH_DENIED', `access to ${path} is not allowed`)
      },
    }
    const broken: Workspace = {
      ...mem,
      read: async () => {
        throw new Error('disk on fire')
      },
    }

    // Act
    const refused = await commit(denied, PATH, 'absent', writeTransform('x'), signal)
    const failed = commit(broken, PATH, 'absent', writeTransform('x'), signal)

    // Assert
    expect(refused).toEqual(err([{ code: 'PATH_DENIED', message: `access to ${PATH} is not allowed` }]))
    await expect(failed).rejects.toThrow('disk on fire')
  })
})

describe('prepare', () => {
  it('should give the diff without writing (scenario 2.10)', async () => {
    // Arrange
    const workspace = memWorkspace({ [PATH]: CONFIG })
    const { version } = (await workspace.read(PATH, signal))!

    // Act
    const prepared = await prepare(
      workspace,
      PATH,
      version,
      editTransform([{ old_text: '"app"', new_text: '"web"' }]),
      signal,
    )

    // Assert
    expect(prepared.ok && diff(prepared.value)).toBe('@@ -2,1 +2,1 @@\n-  name: "app",\n+  name: "web",')
    expect(workspace.get(PATH)).toBe(CONFIG)
  })

  it('should put replacements on one line in one hunk, and number later hunks in the new file', async () => {
    // Arrange
    const workspace = memWorkspace({ [PATH]: 'a b\nc\nd\n' })
    const { version } = (await workspace.read(PATH, signal))!
    const edits: Edit[] = [
      { old_text: 'a', new_text: 'x' },
      { old_text: 'b', new_text: 'y\nz' },
      { old_text: 'd', new_text: 'w' },
    ]

    // Act
    const prepared = await prepare(workspace, PATH, version, editTransform(edits), signal)

    // Assert
    expect(prepared.ok && diff(prepared.value)).toBe('@@ -1,1 +1,2 @@\n-a b\n+x y\n+z\n@@ -3,1 +4,1 @@\n-d\n+w')
  })

  it('should refuse new text that is not valid Unicode, whatever transform made it', async () => {
    // Arrange
    const workspace = memWorkspace()

    // Act
    const prepared = await prepare(workspace, PATH, 'absent', writeTransform('\uD800'), signal)

    // Assert
    expect(prepared).toMatchObject(err([{ code: 'INVALID_INPUT' }]))
  })
})

describe('transforms (L4)', () => {
  // Transforms that grow, rewrite and refuse, so a chain can succeed or stop anywhere
  const transform = fc.constantFrom<Transform>(
    text => ok(`${text}a`),
    text => ok(text.replaceAll('a', 'bb')),
    text => (text.length > 6 ? err([{ code: 'NO_CHANGE' }]) : ok(`x${text}`)),
    editTransform([{ old_text: 'ab', new_text: 'a' }]),
  )
  const text = fc.string({ unit: fc.constantFrom('a', 'b'), maxLength: 6 })

  it('should compose the same way however a chain is grouped, with the empty chain as the unit', () => {
    fc.assert(
      fc.property(transform, transform, transform, text, (f, g, h, t) => {
        // Act
        const flat = chain(f, g, h)(t)

        // Assert
        expect(chain(chain(f, g), h)(t)).toEqual(flat)
        expect(chain(f, chain(g, h))(t)).toEqual(flat)
        expect(chain(chain(), f)(t)).toEqual(f(t))
        expect(chain(f, chain())(t)).toEqual(f(t))
      }),
    )
  })

  it('should run a later transform on what the earlier one returned, and stop at the first error', () => {
    // Arrange
    const rename = editTransform([{ old_text: 'timeout', new_text: 'timeoutMs' }])
    const raise = editTransform([{ old_text: 'timeoutMs: 1000', new_text: 'timeoutMs: 2000' }])

    // Act
    const both = chain(rename, raise)(CONFIG)
    const wrongOrder = chain(raise, rename)(CONFIG)

    // Assert
    expect(both).toEqual(ok(CONFIG.replace('timeout: 1000', 'timeoutMs: 2000')))
    expect(wrongOrder).toMatchObject(err([{ code: 'MATCH_COUNT', edit: 0, found: 0 }]))
  })

  it('should say where similar text is when old_text is not found, only if given hinters', () => {
    // Arrange
    const go = 'func f() error {\n\treturn err\n}\n'
    const edits: Edit[] = [{ old_text: '    return err', new_text: '    return nil' }]

    // Act
    const plain = editTransform(edits)(go)
    const hinted = editTransform(edits, defaultHinters)(go)

    // Assert
    expect(plain).toEqual(err([{ code: 'MATCH_COUNT', edit: 0, expected: 1, found: 0, lines: [] }]))
    expect(hinted).toMatchObject(
      err([{ code: 'MATCH_COUNT', hints: [{ line: 2, reason: 'differs only in indentation or trailing spaces' }] }]),
    )
  })
})

// Helpers

function spied(inner: Workspace): { workspace: Workspace; publishes: () => number } {
  let n = 0
  return {
    workspace: {
      ...inner,
      publish: async (...args) => {
        n++
        return inner.publish(...args)
      },
    },
    publishes: () => n,
  }
}
