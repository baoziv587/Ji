// The local file system behind the Store port. Publishing writes a temporary file next to the target, syncs it and
// renames it over the target, so readers see the old file or the new one, never a mix.
//
//   Guarantee: within one store instance (wrapped in locked), a write from a stale version is always rejected. An
//   outside process writing between the version check and the rename is not detected; that window remains.

import type { Commit, Expected, Snapshot, Store, Version } from './store.ts'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { StoreError } from './store.ts'

interface Current extends Snapshot {
  mode: number
  links: number
}

export function localStore(): Store {
  return {
    async read(path, signal) {
      const current = await inspect(path, signal)
      return current && { bytes: current.bytes, version: current.version }
    },
    publish,
  }
}

/** realpath, extended to paths that do not exist yet: the nearest existing parent is resolved. */
export async function realPath(path: string): Promise<string> {
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

async function publish(path: string, expected: Expected, next: Uint8Array, signal: AbortSignal): Promise<Commit> {
  const current = await inspect(path, signal)
  if ((current?.version ?? 'absent') !== expected) {
    return { state: 'stale', current: current?.version }
  }
  if (current && current.links > 1) {
    throw new StoreError('UNSUPPORTED_FILE', `${path} has other hard links, which replacing it would break`)
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
  return { state: 'applied', version }
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
  if (link.isSymbolicLink()) {
    throw new StoreError('UNSUPPORTED_FILE', `${path} is a symbolic link; wrap the store in canonical(store, realPath)`)
  }
  if (!link.isFile()) {
    throw new StoreError('UNSUPPORTED_FILE', `${path} is not a regular file`)
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
