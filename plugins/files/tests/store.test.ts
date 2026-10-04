// Store port: compare-and-set (L6), decorator order (L8) and the local file system adapter
import type { MemStore, Store, Version } from '../src/index.ts'
import { chmod, link, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { canonical, encode, guarded, localStore, locked, memStore, realPath, StoreError } from '../src/index.ts'

const signal = new AbortController().signal

describe('memStore (L6)', () => {
  it('should apply at most one of two writes made from the same version', async () => {
    // Arrange
    const store = memStore({ '/w/a.ts': 'one' })
    const { version } = (await store.read('/w/a.ts', signal))!

    // Act
    const results = await Promise.all([
      store.publish('/w/a.ts', version, encode('two'), signal),
      store.publish('/w/a.ts', version, encode('three'), signal),
    ])

    // Assert
    expect(results.map(r => r.state)).toEqual(['applied', 'stale'])
    expect(store.get('/w/a.ts')).toBe('two')
  })

  it('should treat absent as a version: create only when the file does not exist', async () => {
    // Arrange
    const store = memStore({ '/w/a.ts': 'one' })

    // Act
    const existing = await store.publish('/w/a.ts', 'absent', encode('x'), signal)
    const created = await store.publish('/w/b.ts', 'absent', encode('x'), signal)

    // Assert
    expect(existing.state).toBe('stale')
    expect(created.state).toBe('applied')
  })
})

describe('decorators (L8)', () => {
  it('should serialize writes through two aliases of one file when canonical is outside locked', async () => {
    // Arrange
    const mem = memStore({ '/real/a.ts': 'one' })
    const store = canonical(locked(racy(mem)), alias)
    const { version } = (await store.read('/link/a.ts', signal))!

    // Act
    const results = await Promise.all([
      store.publish('/link/a.ts', version, encode('two'), signal),
      store.publish('/real/a.ts', version, encode('three'), signal),
    ])

    // Assert
    expect(results.map(r => r.state).sort()).toEqual(['applied', 'stale'])
  })

  it('should let both writes through when locked is outside canonical (sensitivity check)', async () => {
    // Arrange
    const mem = memStore({ '/real/a.ts': 'one' })
    const store = locked(canonical(racy(mem), alias))
    const { version } = (await store.read('/link/a.ts', signal))!

    // Act
    const results = await Promise.all([
      store.publish('/link/a.ts', version, encode('two'), signal),
      store.publish('/real/a.ts', version, encode('three'), signal),
    ])

    // Assert
    expect(results.map(r => r.state)).toEqual(['applied', 'applied'])
  })

  it('should deny reads and writes outside what guarded allows', async () => {
    // Arrange
    const store = guarded(memStore({ '/etc/hosts': 'x' }), path => path.startsWith('/w/'))

    // Act
    const read = store.read('/etc/hosts', signal)

    // Assert
    await expect(read).rejects.toMatchObject({ name: 'StoreError', code: 'PATH_DENIED' })
  })
})

describe('localStore', () => {
  let dir: string
  beforeEach(async () => {
    dir = await realPath(await mkdtemp(join(tmpdir(), 'plugin-files-')))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('should create a file and its directories, then report the version a read sees', async () => {
    // Arrange
    const store = localStore()
    const path = join(dir, 'src/new/a.ts')

    // Act
    const created = await store.publish(path, 'absent', encode('hello\n'), signal)
    const snapshot = await store.read(path, signal)

    // Assert
    expect(created).toEqual({ state: 'applied', version: snapshot!.version })
    expect(await readFile(path, 'utf8')).toBe('hello\n')
  })

  it('should reject a write from a version some other process has since changed', async () => {
    // Arrange
    const store = localStore()
    const path = join(dir, 'a.ts')
    await writeFile(path, 'one')
    const { version } = (await store.read(path, signal))!
    await writeFile(path, 'two, from an editor')

    // Act
    const result = await store.publish(path, version, encode('three'), signal)

    // Assert
    expect(result.state).toBe('stale')
    expect(await readFile(path, 'utf8')).toBe('two, from an editor')
  })

  it('should keep the file mode and leave no temporary file behind', async () => {
    // Arrange
    const store = localStore()
    const path = join(dir, 'run.sh')
    await writeFile(path, 'echo one\n')
    await chmod(path, 0o750)
    const { version } = (await store.read(path, signal))!

    // Act
    await store.publish(path, version, encode('echo two\n'), signal)

    // Assert
    expect((await stat(path)).mode & 0o777).toBe(0o750)
    expect(await readdir(dir)).toEqual(['run.sh'])
  })

  it('should apply at most one of two concurrent writes from the same version when locked (L6)', async () => {
    // Arrange
    const store = locked(localStore())
    const path = join(dir, 'a.ts')
    await writeFile(path, 'one')
    const { version } = (await store.read(path, signal))!

    // Act
    const results = await Promise.all([
      store.publish(path, version, encode('two'), signal),
      store.publish(path, version, encode('three'), signal),
    ])

    // Assert
    expect(results.map(r => r.state)).toEqual(['applied', 'stale'])
    expect(await readFile(path, 'utf8')).toBe('two')
  })

  it('should refuse symbolic links and files with other hard links', async () => {
    // Arrange
    const store = localStore()
    const target = join(dir, 'a.ts')
    await writeFile(target, 'one')
    await symlink(target, join(dir, 'link.ts'))
    await link(target, join(dir, 'hard.ts'))
    const { version } = (await store.read(target, signal))!

    // Act
    const viaLink = store.read(join(dir, 'link.ts'), signal)
    const hard = store.publish(target, version, encode('two'), signal)

    // Assert
    await expect(viaLink).rejects.toBeInstanceOf(StoreError)
    await expect(hard).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE' })
    expect(await readFile(join(dir, 'hard.ts'), 'utf8')).toBe('one')
  })

  it('should deny a symbolic link that leads out of the workspace (scenario 2.1)', async () => {
    // Arrange
    const workspace = join(dir, 'workspace')
    await writeFile(join(dir, 'secret'), 'x')
    await mkdir(workspace)
    await symlink(join(dir, 'secret'), join(workspace, 'innocent.txt'))
    const store = canonical(
      guarded(localStore(), path => path.startsWith(`${workspace}/`)),
      realPath,
    )

    // Act
    const read = store.read(join(workspace, 'innocent.txt'), signal)

    // Assert
    await expect(read).rejects.toMatchObject({ code: 'PATH_DENIED' })
  })
})

// Helpers

/** /link is an alias of /real. */
async function alias(path: string): Promise<string> {
  return path.replace(/^\/link\//, '/real/')
}

/** Checks the version, waits, then writes without checking again: the gap localStore has between stat and rename. */
function racy(mem: MemStore): Store {
  return {
    read: (path, s) => mem.read(path, s),
    async publish(path, expected, next, s) {
      const current = (await mem.read(path, s))?.version
      await new Promise(resolve => setTimeout(resolve, 1))
      if ((current ?? 'absent') !== expected) {
        return { state: 'stale', current }
      }
      mem.set(path, next)
      return { state: 'applied', version: (await mem.read(path, s))!.version as Version }
    },
  }
}
