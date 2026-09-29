import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearCache, ensureDataset, listCache } from '../src/cache.ts'

const DATASET = 'owner/name'

/** A fake Hugging Face serving `files` at `revision`; counts the file downloads it serves. */
function hub(revision: string, files: Record<string, string>, { corrupt = false, down = false } = {}) {
  const served: string[] = []
  const sha = (text: string): string => createHash('sha256').update(text).digest('hex')

  const get = (async (input: string | URL) => {
    const url = String(input)
    if (down) {
      throw new TypeError('fetch failed')
    }
    if (url.endsWith('/revision/main')) {
      return Response.json({ sha: revision })
    }
    if (url.includes(`/tree/${revision}/data`)) {
      return Response.json(
        Object.entries(files).map(([path, text]) => ({
          type: 'file',
          path,
          size: text.length,
          lfs: { oid: sha(text), size: text.length },
        })),
      )
    }
    const path = url.split(`/resolve/${revision}/`)[1]
    if (path !== undefined && path in files) {
      served.push(path)
      return new Response(corrupt ? files[path].toUpperCase() : files[path])
    }
    return new Response('not found', { status: 404 })
  }) as typeof fetch

  return { get, served }
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ji-cache-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('ensureDataset', () => {
  it('should download each file once and read it from disk after that', async () => {
    // Arrange
    const { get, served } = hub('rev1', { 'data/a.parquet': 'aaaa', 'data/b.parquet': 'bbbbbb' })
    const progress: number[] = []

    // Act
    const first = await ensureDataset({ dir, dataset: DATASET, fetch: get, onProgress: done => progress.push(done) })
    const second = await ensureDataset({ dir, dataset: DATASET, fetch: get })

    // Assert
    expect(served).toEqual(['data/a.parquet', 'data/b.parquet'])
    expect(first).toMatchObject({ revision: 'rev1', downloaded: 10, offline: false })
    expect(second).toMatchObject({ revision: 'rev1', downloaded: 0, offline: false })
    expect(second.files.map(f => readFileSync(f, 'utf8'))).toEqual(['aaaa', 'bbbbbb'])
    expect(progress.at(-1)).toBe(10)
  })

  it('should fetch a new revision and drop the old one', async () => {
    // Arrange
    await ensureDataset({ dir, dataset: DATASET, fetch: hub('rev1', { 'data/a.parquet': 'old' }).get })

    // Act
    const next = await ensureDataset({ dir, dataset: DATASET, fetch: hub('rev2', { 'data/a.parquet': 'new!' }).get })

    // Assert
    expect(readFileSync(next.files[0], 'utf8')).toBe('new!')
    expect(readdirSync(join(dir, 'owner__name'))).toEqual(['rev2'])
  })

  it('should fall back to the newest cached revision when Hugging Face is unreachable', async () => {
    // Arrange
    await ensureDataset({ dir, dataset: DATASET, fetch: hub('rev1', { 'data/a.parquet': 'aaaa' }).get })

    // Act
    const offline = await ensureDataset({ dir, dataset: DATASET, fetch: hub('rev1', {}, { down: true }).get })

    // Assert
    expect(offline).toMatchObject({ revision: 'rev1', offline: true, downloaded: 0 })
  })

  it('should fail offline with nothing cached', async () => {
    await expect(ensureDataset({ dir, dataset: DATASET, fetch: hub('rev1', {}, { down: true }).get })).rejects.toThrow(
      /nothing is cached/,
    )
  })

  it('should reject a file whose checksum does not match, and keep nothing of it', async () => {
    // Arrange
    const { get } = hub('rev1', { 'data/a.parquet': 'aaaa' }, { corrupt: true })

    // Act & Assert
    await expect(ensureDataset({ dir, dataset: DATASET, fetch: get })).rejects.toThrow(/corrupt/)
    expect(existsSync(join(dir, 'owner__name', 'rev1', 'data', 'a.parquet'))).toBe(false)
    expect(existsSync(join(dir, 'owner__name', 'rev1', 'data', 'a.parquet.part'))).toBe(false)
  })

  it('should resume an interrupted download, fetching only the missing files', async () => {
    // Arrange: the second file fails once, as a dropped connection would
    const files = { 'data/a.parquet': 'aaaa', 'data/b.parquet': 'bbbb' }
    const broken = hub('rev1', { 'data/a.parquet': files['data/a.parquet'] })
    await expect(ensureDataset({ dir, dataset: DATASET, fetch: broken.get })).resolves.toBeDefined()
    rmSync(join(dir, 'owner__name', 'rev1', 'manifest.json'))
    const { get, served } = hub('rev1', files)

    // Act
    await ensureDataset({ dir, dataset: DATASET, fetch: get })

    // Assert
    expect(served).toEqual(['data/b.parquet'])
  })
})

describe('listCache and clearCache', () => {
  it('should list what is cached and free it', async () => {
    // Arrange
    await ensureDataset({ dir, dataset: DATASET, fetch: hub('rev1', { 'data/a.parquet': 'aaaa' }).get })

    // Act
    const listed = listCache(dir)
    const freed = clearCache(dir)

    // Assert
    expect(listed).toMatchObject([{ dataset: DATASET, revision: 'rev1', complete: true }])
    expect(freed).toBeGreaterThanOrEqual(4)
    expect(existsSync(dir)).toBe(false)
    expect(listCache(dir)).toEqual([])
  })
})
