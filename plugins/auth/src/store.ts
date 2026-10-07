// A CredentialStore on one JSON file: `{ "<provider>": credential }`, readable by its owner only. Every write holds a
// lock on the file, in this process and across processes, so two sessions refreshing the same OAuth token do not lose
// each other's: the second finds the first's and uses it.

import type { Credential, CredentialInfo, CredentialStore } from '@ji.dev/llm'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import process from 'node:process'
import { lock } from 'proper-lockfile'

type Credentials = Record<string, Credential>

/** Waits up to about two seconds for another process's write; a lock older than ten seconds is a crashed one's. */
const LOCK = { realpath: false, stale: 10_000, retries: { retries: 10, minTimeout: 20, maxTimeout: 400 } }

export function createFileCredentialStore(file: string): CredentialStore {
  /** Writes in this process, one after the other. */
  let chain: Promise<unknown> = Promise.resolve()

  const write = <T>(change: (all: Credentials) => Promise<{ all: Credentials; result: T }>): Promise<T> => {
    const run = chain.then(
      () => locked(file, change),
      () => locked(file, change),
    )
    chain = run.catch(() => undefined)
    return run
  }

  return {
    read: async provider => (await load(file))[provider],

    list: async () =>
      Object.entries(await load(file)).map(([providerId, c]): CredentialInfo => ({ providerId, type: c.type })),

    modify: (provider, fn) =>
      write(async all => {
        const next = await fn(all[provider])
        if (next === undefined) {
          return { all, result: all[provider] }
        }
        return { all: { ...all, [provider]: next }, result: next }
      }),

    delete: provider =>
      write(async all => {
        const { [provider]: _, ...rest } = all
        return { all: rest, result: undefined }
      }),
  }
}

/** Reads, changes and writes back under the file's lock; nothing is written when the change leaves it as it was. */
async function locked<T>(
  file: string,
  change: (all: Credentials) => Promise<{ all: Credentials; result: T }>,
): Promise<T> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  const release = await lock(file, LOCK)
  try {
    const before = await load(file)
    const { all, result } = await change(before)
    if (all !== before) {
      await save(file, all)
    }
    return result
  } finally {
    await release()
  }
}

/** A file not there yet is an empty store; one that is not a credential map is an error that names it. */
async function load(file: string): Promise<Credentials> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if (isMissing(error)) {
      return {}
    }
    throw error
  }
  return parseCredentials(text, file)
}

/** Written next to the file and renamed over it, so a reader never sees half of it. */
async function save(file: string, all: Credentials): Promise<void> {
  const draft = `${file}.${process.pid}.tmp`
  await writeFile(draft, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 })
  await rename(draft, file)
}

function parseCredentials(text: string, file: string): Credentials {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(`${file} is not JSON`, { cause: error })
  }

  if (!isRecord(parsed)) {
    throw new Error(`${file} does not hold a map of credentials by provider`)
  }
  for (const [provider, credential] of Object.entries(parsed)) {
    if (!isCredential(credential)) {
      throw new Error(`${file}: the credential of ${provider} has no type`)
    }
  }
  return parsed as Credentials
}

function isCredential(value: unknown): value is Credential {
  return isRecord(value) && (value.type === 'api_key' || value.type === 'oauth')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
