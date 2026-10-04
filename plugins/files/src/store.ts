// The Store port is the only place the edit tools do IO (RFC §5.3). Decorators wrap it: canonical outermost, so locks,
// permissions and versions all key on the real path.

declare const opaqueVersion: unique symbol

/** Made by the store, compared only for equality. */
export type Version = string & { readonly [opaqueVersion]: true }

/** A version, or 'absent': the file must not exist. */
export type Expected = Version | 'absent'

export interface Snapshot {
  bytes: Uint8Array
  version: Version
}

/** What publish reports once it may have written; a throw means it did not. */
export type Commit =
  | { state: 'applied'; version: Version }
  | { state: 'stale'; current?: Version }
  | { state: 'unknown'; error: unknown }

export interface Reader {
  /** undefined when the file does not exist. */
  read: (path: string, signal: AbortSignal) => Promise<Snapshot | undefined>
}

export interface Publisher {
  /**
   * Writes `next` if the file is still at `expected`. Throwing means nothing was written; past the point of no return
   * it resolves to 'applied' or 'unknown' instead, and the signal no longer stops it.
   */
  publish: (path: string, expected: Expected, next: Uint8Array, signal: AbortSignal) => Promise<Commit>
}

export type Store = Reader & Publisher

/** A failure the model should see as a result, not one a retry may fix. */
export class StoreError extends Error {
  readonly code: 'PATH_DENIED' | 'UNSUPPORTED_FILE'

  constructor(code: StoreError['code'], message: string) {
    super(message)
    this.name = 'StoreError'
    this.code = code
  }
}

export interface MemStore extends Store {
  /** The file's text, or undefined when it does not exist. */
  get: (path: string) => string | undefined
  /** Changes a file the way an outside process would: new version, no check. undefined deletes it. */
  set: (path: string, content: string | Uint8Array | undefined) => void
}

/** In memory, with a real compare-and-set: for tests and scripts. */
export function memStore(initial: Record<string, string | Uint8Array> = {}): MemStore {
  const files = new Map<string, Snapshot>()
  const encoder = new TextEncoder()
  let generation = 0

  const set = (path: string, content: string | Uint8Array | undefined): void => {
    if (content === undefined) {
      files.delete(path)
      return
    }
    const bytes = typeof content === 'string' ? encoder.encode(content) : content
    files.set(path, { bytes, version: `m${++generation}` as Version })
  }

  for (const [path, content] of Object.entries(initial)) {
    set(path, content)
  }

  return {
    async read(path, signal) {
      signal.throwIfAborted()
      return files.get(path)
    },
    async publish(path, expected, next, signal) {
      signal.throwIfAborted()
      const current = files.get(path)?.version
      if ((current ?? 'absent') !== expected) {
        return { state: 'stale', current }
      }
      set(path, next)
      return { state: 'applied', version: files.get(path)!.version }
    },
    get: path => {
      const file = files.get(path)
      return file && new TextDecoder().decode(file.bytes)
    },
    set,
  }
}

/** Resolves every path before the inner store sees it, so aliases of one file share its lock and version. */
export function canonical(store: Store, resolve: (path: string) => Promise<string>): Store {
  return {
    read: async (path, signal) => store.read(await resolve(path), signal),
    publish: async (path, expected, next, signal) => store.publish(await resolve(path), expected, next, signal),
  }
}

/** Static permission check on the path the inner store sees; put it inside canonical so it sees the real path. */
export function guarded(store: Store, allow: (path: string) => boolean): Store {
  const check = (path: string): void => {
    if (!allow(path)) {
      throw new StoreError('PATH_DENIED', `access to ${path} is not allowed`)
    }
  }
  return {
    read: async (path, signal) => {
      check(path)
      return store.read(path, signal)
    },
    publish: async (path, expected, next, signal) => {
      check(path)
      return store.publish(path, expected, next, signal)
    },
  }
}

/**
 * Publishes to one path run one at a time, so a store whose check and write are separate steps (localStore) still
 * rejects the second of two writes made from the same version.
 */
export function locked(store: Store): Store {
  const tails = new Map<string, Promise<unknown>>()

  return {
    read: (path, signal) => store.read(path, signal),
    publish(path, expected, next, signal) {
      const run = (tails.get(path) ?? Promise.resolve()).then(() => store.publish(path, expected, next, signal))
      const tail = run.catch(() => {})
      tails.set(path, tail)
      void tail.then(() => {
        if (tails.get(path) === tail) {
          tails.delete(path)
        }
      })
      return run
    },
  }
}
