// The local file system behind the Workspace port. Publishing writes a temporary file next to the target, syncs it and
// renames it over the target, so readers see the old file or the new one, never a mix.
//
//   Guarantee: within one localWorkspace instance, a write from a stale version is always rejected. An outside process
//   writing between the version check and the rename is not detected; that window remains.

import type { Expected, Snapshot, Version, Workspace } from './workspace.ts'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve as resolvePath, sep } from 'node:path'
import process from 'node:process'
import { FileError } from './workspace.ts'

export interface LocalOptions {
  /** Which real paths may be read and written. Default: those inside root. */
  allow?: (path: string) => boolean
}

interface Current extends Snapshot {
  mode: number
  links: number
}

/**
 * The files under `root`; relative paths resolve against it. Everything keys on the real path: a symbolic link shares
 * the lock and version of its target, and one that leads outside root is denied.
 */
export function localWorkspace(root: string = process.cwd(), { allow }: LocalOptions = {}): Workspace {
  let top: Promise<string> | undefined
  const tails = new Map<string, Promise<unknown>>()

  async function resolve(path: string): Promise<string> {
    const base = await (top ??= realPath(resolvePath(root)))
    const real = await realPath(resolvePath(base, path))
    if (!(allow ? allow(real) : inside(base, real))) {
      throw new FileError('PATH_DENIED', `access to ${path} is not allowed`)
    }
    return real
  }

  /** Publishes to one file run one at a time: the version check and the rename are separate steps. */
  function inTurn<T>(path: string, run: () => Promise<T>): Promise<T> {
    const result = (tails.get(path) ?? Promise.resolve()).then(run)
    const tail = result.catch(() => {})
    tails.set(path, tail)
    void tail.then(() => {
      if (tails.get(path) === tail) {
        tails.delete(path)
      }
    })
    return result
  }

  return {
    resolve,
    async read(path, signal) {
      const current = await inspect(await resolve(path), signal)
      return current && { bytes: current.bytes, version: current.version }
    },
    async publish(path, expected, next, signal) {
      const real = await resolve(path)
      return inTurn(real, () => publish(real, expected, next, signal))
    },
  }
}

/** realpath, extended to paths that do not exist yet: the nearest existing parent is resolved. */
async function realPath(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch (e) {
    if (!isMissing(e)) {
      throw e
    }
    const parent = dirname(path)
    return parent === path ? path : join(await realPath(parent), basename(path))
  }
}

function inside(root: string, path: string): boolean {
  const rest = relative(root, path)
  return rest !== '..' && !rest.startsWith(`..${sep}`) && !isAbsolute(rest)
}

async function publish(
  path: string,
  expected: Expected,
  next: Uint8Array,
  signal: AbortSignal,
): Promise<Version | 'stale'> {
  const current = await inspect(path, signal)
  if ((current?.version ?? 'absent') !== expected) {
    return 'stale'
  }
  if (current && current.links > 1) {
    throw new FileError('UNSUPPORTED_FILE', `${path} has other hard links, which replacing it would break`)
  }

  await mkdir(dirname(path), { recursive: true })
  const tmp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`)
  let version: Version
  try {
    const file = await open(tmp, 'wx', current?.mode ?? 0o666)
    try {
      if (current) {
        // open applies the umask; an existing file keeps its exact mode
        await file.chmod(current.mode)
      }
      await file.writeFile(next)
      await file.sync()
      // rename keeps the inode and mtime, so this is the version a later read sees
      version = versionOf(next, await file.stat({ bigint: true }))
    } finally {
      await file.close()
    }
    // The last moment a cancel can still stop the write
    signal.throwIfAborted()
    await rename(tmp, path)
  } catch (e) {
    await rm(tmp, { force: true })
    throw e
  }
  return version
}

async function inspect(path: string, signal: AbortSignal): Promise<Current | undefined> {
  signal.throwIfAborted()
  let link
  try {
    link = await lstat(path)
  } catch (e) {
    if (isMissing(e)) {
      return undefined
    }
    throw e
  }
  // resolve has followed every link that leads somewhere; one still here is dangling
  if (link.isSymbolicLink()) {
    throw new FileError('UNSUPPORTED_FILE', `${path} is a symbolic link to a file that does not exist`)
  }
  if (!link.isFile()) {
    throw new FileError('UNSUPPORTED_FILE', `${path} is not a regular file`)
  }

  const file = await open(path, 'r')
  try {
    const stat = await file.stat({ bigint: true })
    const bytes = await file.readFile()
    return { bytes, version: versionOf(bytes, stat), mode: Number(stat.mode & 0o7777n), links: Number(stat.nlink) }
  } finally {
    await file.close()
  }
}

/** Identity, modification time and content: a hash alone would miss a file changed and changed back. */
function versionOf(bytes: Uint8Array, stat: { ino: bigint; mtimeNs: bigint }): Version {
  const hash = createHash('sha256')
    .update(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
    .digest('hex')
  return `${stat.ino}:${stat.mtimeNs}:${hash.slice(0, 16)}` as Version
}

function isMissing(e: unknown): boolean {
  return (e as { code?: unknown }).code === 'ENOENT'
}
