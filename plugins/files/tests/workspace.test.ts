// Workspace port: compare-and-set (L6), one identity for every alias of a file (L8) and the local file system backend
import type { Workspace } from '../src/index.ts'
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { encode } from '../src/core/view.ts'
import { FileError, localWorkspace, memWorkspace } from '../src/index.ts'

const signal = new AbortController().signal

describe('memWorkspace (L6)', () => {
  it('should apply at most one of two writes made from the same version', async () => {
    // Arrange
    const workspace = memWorkspace({ '/w/a.ts': 'one' })
    const { version } = (await workspace.read('/w/a.ts', signal))!

    // Act
    const results = await Promise.all([
      workspace.publish('/w/a.ts', version, encode('two'), signal),
      workspace.publish('/w/a.ts', version, encode('three'), signal),
    ])

    // Assert
    expect(results.map(applied)).toEqual([true, false])
    expect(workspace.get('/w/a.ts')).toBe('two')
  })

  it('should treat absent as a version: create only when the file does not exist', async () => {
    // Arrange
    const workspace = memWorkspace({ '/w/a.ts': 'one' })

    // Act
    const existing = await workspace.publish('/w/a.ts', 'absent', encode('x'), signal)
    const created = await workspace.publish('/w/b.ts', 'absent', encode('x'), signal)

    // Assert
    expect(applied(existing)).toBe(false)
    expect(applied(created)).toBe(true)
  })

  it('should give every alias of a file the identity, content and version of that file (L8)', async () => {
    // Arrange
    const workspace = memWorkspace({ '/real/a.ts': 'one' }, path => path.replace(/^\/link\//, '/real/'))
    const { version } = (await workspace.read('/link/a.ts', signal))!

    // Act
    const results = await Promise.all([
      workspace.publish('/link/a.ts', version, encode('two'), signal),
      workspace.publish('/real/a.ts', version, encode('three'), signal),
    ])

    // Assert
    expect(await workspace.resolve('/link/a.ts')).toBe('/real/a.ts')
    expect(results.map(applied)).toEqual([true, false])
    expect(workspace.get('/real/a.ts')).toBe('two')
  })
})

describe('localWorkspace', () => {
  let dir: string
  let workspace: Workspace
  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'plugin-files-')))
    workspace = localWorkspace(dir)
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('should create a file and its directories under root, then report the version a read sees', async () => {
    // Act
    const created = await workspace.publish('src/new/a.ts', 'absent', encode('hello\n'), signal)
    const snapshot = await workspace.read(join(dir, 'src/new/a.ts'), signal)

    // Assert
    expect(created).toBe(snapshot!.version)
    expect(await readFile(join(dir, 'src/new/a.ts'), 'utf8')).toBe('hello\n')
  })

  it('should reject a write from a version some other process has since changed', async () => {
    // Arrange
    const path = join(dir, 'a.ts')
    await writeFile(path, 'one')
    const { version } = (await workspace.read(path, signal))!
    await writeFile(path, 'two, from an editor')

    // Act
    const result = await workspace.publish(path, version, encode('three'), signal)

    // Assert
    expect(result).toBe('stale')
    expect(await readFile(path, 'utf8')).toBe('two, from an editor')
  })

  it('should keep the file mode and leave no temporary file behind', async () => {
    // Arrange
    const path = join(dir, 'run.sh')
    await writeFile(path, 'echo one\n')
    await chmod(path, 0o750)
    const { version } = (await workspace.read(path, signal))!

    // Act
    await workspace.publish(path, version, encode('echo two\n'), signal)

    // Assert
    expect((await stat(path)).mode & 0o777).toBe(0o750)
    expect(await readdir(dir)).toEqual(['run.sh'])
  })

  it('should apply at most one of two concurrent writes from the same version (L6)', async () => {
    // Arrange
    const path = join(dir, 'a.ts')
    await writeFile(path, 'one')
    const { version } = (await workspace.read(path, signal))!

    // Act
    const results = await Promise.all([
      workspace.publish(path, version, encode('two'), signal),
      workspace.publish(path, version, encode('three'), signal),
    ])

    // Assert: whichever resolves its path first goes first
    expect(results.filter(applied)).toHaveLength(1)
    expect(await readFile(path, 'utf8')).toBe(applied(results[0]) ? 'two' : 'three')
  })

  it('should treat a symbolic link as the file it leads to: same identity, version and lock (L8)', async () => {
    // Arrange
    const target = join(dir, 'a.ts')
    await writeFile(target, 'one')
    await symlink(target, join(dir, 'link.ts'))
    const { version } = (await workspace.read('link.ts', signal))!
    const direct = (await workspace.read('a.ts', signal))!.version

    // Act
    const results = await Promise.all([
      workspace.publish('link.ts', version, encode('two'), signal),
      workspace.publish('a.ts', version, encode('three'), signal),
    ])

    // Assert
    expect(await workspace.resolve('link.ts')).toBe(target)
    expect(version).toBe(direct)
    expect(results.filter(applied)).toHaveLength(1)
    expect(await readFile(target, 'utf8')).toBe(applied(results[0]) ? 'two' : 'three')
  })

  it('should refuse a file with other hard links and a symbolic link to nothing', async () => {
    // Arrange
    const target = join(dir, 'a.ts')
    await writeFile(target, 'one')
    await link(target, join(dir, 'hard.ts'))
    await symlink(join(dir, 'missing.ts'), join(dir, 'dangling.ts'))
    const { version } = (await workspace.read(target, signal))!

    // Act
    const [hard, dangling] = await Promise.allSettled([
      workspace.publish(target, version, encode('two'), signal),
      workspace.read('dangling.ts', signal),
    ])

    // Assert
    expect(hard).toMatchObject({ reason: { name: 'FileError', code: 'UNSUPPORTED_FILE' } })
    expect(dangling).toMatchObject({ reason: expect.any(FileError) })
    expect(await readFile(join(dir, 'hard.ts'), 'utf8')).toBe('one')
  })

  it('should deny every way out of root: a path above it and a symbolic link that leads outside (scenario 2.1)', async () => {
    // Arrange
    const inner = join(dir, 'workspace')
    await writeFile(join(dir, 'secret'), 'x')
    await mkdir(inner)
    await symlink(join(dir, 'secret'), join(inner, 'innocent.txt'))
    const confined = localWorkspace(inner)

    // Act
    const attempts = await Promise.allSettled([
      confined.read('../secret', signal),
      confined.read('innocent.txt', signal),
      confined.publish(join(dir, 'secret'), 'absent', encode('y'), signal),
    ])

    // Assert
    expect(attempts.map(a => a.status === 'rejected' && a.reason.code)).toEqual([
      'PATH_DENIED',
      'PATH_DENIED',
      'PATH_DENIED',
    ])
    expect(await readFile(join(dir, 'secret'), 'utf8')).toBe('x')
  })

  it('should let `allow` decide instead, on the real path', async () => {
    // Arrange
    await writeFile(join(dir, '.env'), 'SECRET=1')
    await writeFile(join(dir, 'a.ts'), 'one')
    await symlink(join(dir, '.env'), join(dir, 'config.txt'))
    const noSecrets = localWorkspace(dir, { allow: path => !path.endsWith('.env') })

    // Act
    const allowed = await noSecrets.read('a.ts', signal)
    const viaLink = noSecrets.read('config.txt', signal)

    // Assert
    expect(allowed).toBeDefined()
    await expect(viaLink).rejects.toMatchObject({ code: 'PATH_DENIED' })
  })
})

// Helpers

function applied(result: string): boolean {
  return result !== 'stale'
}
