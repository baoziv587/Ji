// The dataset's parquet files, downloaded once and kept on disk, so importing again (a new --db, a deleted database,
// `pnpm replay import`) reads local files instead of fetching 220 MB from Hugging Face.
//
//   <dir>/<owner>__<name>/<revision>/data/*.parquet    one directory per dataset revision
//   <dir>/<owner>__<name>/<revision>/manifest.json     written last: the revision is complete
//
//   ensureDataset: ask Hugging Face for the current revision
//     cached and complete      -> use it, nothing downloaded
//     not cached               -> download each file to .part, check size and sha256, rename; then the manifest;
//                                 then drop older revisions of the dataset
//     Hugging Face unreachable -> the newest complete revision on disk, or an error if there is none
//
// `fetch` is a parameter so tests can serve the dataset without a network.

import type { ReadableStream as WebStream } from 'node:stream/web'
import { createHash } from 'node:crypto'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export const DATASET = 'yoonholee/terminalbench-trajectories'

/** $XDG_CACHE_HOME/ji-replay, else ~/.cache/ji-replay: shared by every clone and worktree on the machine. */
export const DEFAULT_CACHE = join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'ji-replay')

const HUB = 'https://huggingface.co'
const MANIFEST = 'manifest.json'

interface RemoteFile {
  path: string
  size: number
  sha256: string
}

interface Manifest {
  dataset: string
  revision: string
  files: RemoteFile[]
  completedAt: string
}

export interface CachedDataset {
  revision: string
  /** Local paths of the parquet files. */
  files: string[]
  /** Bytes fetched this time; 0 when everything came from the cache. */
  downloaded: number
  /** Hugging Face could not be reached, so this is the newest revision already on disk. */
  offline: boolean
}

export interface EnsureOptions {
  dir?: string
  dataset?: string
  /** Called as bytes arrive; `total` covers the files still to download. */
  onProgress?: (done: number, total: number) => void
  fetch?: typeof fetch
}

export async function ensureDataset({
  dir = DEFAULT_CACHE,
  dataset = DATASET,
  onProgress,
  fetch: get = fetch,
}: EnsureOptions = {}): Promise<CachedDataset> {
  const root = datasetDir(dir, dataset)

  let revision: string
  try {
    revision = await currentRevision(get, dataset)
  } catch (error) {
    const cached = latestComplete(root)
    if (cached === undefined) {
      throw new Error(`cannot reach Hugging Face and nothing is cached in ${root}: ${String(error)}`)
    }
    return { revision: cached.revision, files: localPaths(root, cached), downloaded: 0, offline: true }
  }

  const complete = readManifest(join(root, revision))
  if (complete !== undefined) {
    return { revision, files: localPaths(root, complete), downloaded: 0, offline: false }
  }

  const remote = await listParquet(get, dataset, revision)
  const missing = remote.filter(f => !isComplete(join(root, revision, f.path), f))
  const total = missing.reduce((sum, f) => sum + f.size, 0)
  let done = 0
  for (const file of missing) {
    await download(get, dataset, revision, file, join(root, revision, file.path), bytes => {
      done += bytes
      onProgress?.(done, total)
    })
  }

  const manifest: Manifest = { dataset, revision, files: remote, completedAt: new Date().toISOString() }
  writeFileSync(join(root, revision, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`)
  dropOtherRevisions(root, revision)
  return { revision, files: localPaths(root, manifest), downloaded: done, offline: false }
}

export interface CacheEntry {
  dataset: string
  revision: string
  bytes: number
  complete: boolean
  completedAt?: string
}

/** Every revision on disk under `dir`, complete or not. */
export function listCache(dir = DEFAULT_CACHE): CacheEntry[] {
  return subdirs(dir).flatMap(name =>
    subdirs(join(dir, name)).map(revision => {
      const manifest = readManifest(join(dir, name, revision))
      return {
        dataset: name.replace('__', '/'),
        revision,
        bytes: sizeOf(join(dir, name, revision)),
        complete: manifest !== undefined,
        completedAt: manifest?.completedAt,
      }
    }),
  )
}

/** Removes the whole cache directory; returns the bytes freed. */
export function clearCache(dir = DEFAULT_CACHE): number {
  if (!existsSync(dir)) {
    return 0
  }
  const bytes = sizeOf(dir)
  rmSync(dir, { recursive: true, force: true })
  return bytes
}

async function currentRevision(get: typeof fetch, dataset: string): Promise<string> {
  const info = (await json(get, `${HUB}/api/datasets/${dataset}/revision/main`)) as { sha?: unknown }
  if (typeof info.sha !== 'string') {
    throw new TypeError(`no revision in the answer for ${dataset}`)
  }
  return info.sha
}

async function listParquet(get: typeof fetch, dataset: string, revision: string): Promise<RemoteFile[]> {
  const entries = (await json(get, `${HUB}/api/datasets/${dataset}/tree/${revision}/data`)) as Array<{
    type: string
    path: string
    size: number
    lfs?: { oid: string; size: number }
  }>
  return entries
    .filter(e => e.type === 'file' && e.path.endsWith('.parquet') && e.lfs !== undefined)
    .map(e => ({ path: e.path, size: e.lfs!.size, sha256: e.lfs!.oid }))
    .toSorted((a, b) => a.path.localeCompare(b.path))
}

/** Streams to `<target>.part`, hashing as it goes; only a file with the right size and sha256 gets its real name. */
async function download(
  get: typeof fetch,
  dataset: string,
  revision: string,
  file: RemoteFile,
  target: string,
  onBytes: (n: number) => void,
): Promise<void> {
  const response = await get(`${HUB}/datasets/${dataset}/resolve/${revision}/${file.path}`)
  if (!response.ok || response.body === null) {
    throw new Error(`downloading ${file.path}: HTTP ${response.status}`)
  }

  mkdirSync(dirname(target), { recursive: true })
  const part = `${target}.part`
  const hash = createHash('sha256')
  let size = 0
  const measure = new Transform({
    transform(chunk: Uint8Array, _encoding, callback) {
      hash.update(chunk)
      size += chunk.length
      onBytes(chunk.length)
      callback(null, chunk)
    },
  })

  try {
    // fetch's body is typed with the DOM's ReadableStream; Node's is the same object at runtime
    await pipeline(Readable.fromWeb(response.body as WebStream<Uint8Array>), measure, createWriteStream(part))
    const sha256 = hash.digest('hex')
    if (size !== file.size || sha256 !== file.sha256) {
      throw new Error(
        `${file.path} is corrupt: ${size} bytes with sha256 ${sha256}, expected ${file.size} and ${file.sha256}`,
      )
    }
    renameSync(part, target)
  } finally {
    rmSync(part, { force: true })
  }
}

async function json(get: typeof fetch, url: string): Promise<unknown> {
  const response = await get(url, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`)
  }
  return response.json()
}

/** Written only after its file was checked, so a present file of the right size is the right file. */
function isComplete(path: string, file: RemoteFile): boolean {
  return existsSync(path) && statSync(path).size === file.size
}

function readManifest(revisionDir: string): Manifest | undefined {
  const path = join(revisionDir, MANIFEST)
  if (!existsSync(path)) {
    return undefined
  }
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Manifest
  return manifest.files.every(f => isComplete(join(revisionDir, f.path), f)) ? manifest : undefined
}

function latestComplete(root: string): Manifest | undefined {
  return subdirs(root)
    .flatMap(revision => readManifest(join(root, revision)) ?? [])
    .toSorted((a, b) => b.completedAt.localeCompare(a.completedAt))[0]
}

function dropOtherRevisions(root: string, keep: string): void {
  for (const revision of subdirs(root)) {
    if (revision !== keep) {
      rmSync(join(root, revision), { recursive: true, force: true })
    }
  }
}

function localPaths(root: string, manifest: Manifest): string[] {
  return manifest.files.map(f => join(root, manifest.revision, f.path))
}

function datasetDir(dir: string, dataset: string): string {
  return join(dir, dataset.replace('/', '__'))
}

function subdirs(dir: string): string[] {
  if (!existsSync(dir)) {
    return []
  }
  return readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
}

function sizeOf(path: string): number {
  const stat = statSync(path)
  if (!stat.isDirectory()) {
    return stat.size
  }
  return readdirSync(path).reduce((sum, name) => sum + sizeOf(join(path, name)), 0)
}
