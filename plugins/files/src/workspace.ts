// The Workspace port is the only place the file tools do IO (RFC §5.2): three single-method interfaces. A backend owns the
// identity of a path, so locks, permissions and versions all key on what `resolve` returns.

declare const opaqueVersion: unique symbol

/** Made by the backend, compared only for equality. */
export type Version = string & { readonly [opaqueVersion]: true }

/** A version, or 'absent': the file must not exist. */
export type Expected = Version | 'absent'

export interface Snapshot {
  bytes: Uint8Array
  version: Version
}

export interface Resolver {
  /**
   * The identity of a path: every alias of one file (relative, absolute, through a symbolic link) resolves to the same
   * string. read and publish resolve their path the same way, so callers never have to resolve first.
   */
  resolve: (path: string) => Promise<string>
}

export interface Reader {
  /** undefined when the file does not exist. */
  read: (path: string, signal: AbortSignal) => Promise<Snapshot | undefined>
}

export interface Publisher {
  /**
   * Writes `next` if the file is still at `expected` and returns the new version; 'stale' when it is not. It throws
   * when the write failed or its outcome is not known. Either way, publishing again with the same `expected` is safe:
   * at most one of the two applies, and if the first did, the second returns 'stale'.
   */
  publish: (path: string, expected: Expected, next: Uint8Array, signal: AbortSignal) => Promise<Version | 'stale'>
}

export type Workspace = Resolver & Reader & Publisher

/** A failure the model should see as a result, not one a retry may fix. */
export class FileError extends Error {
  readonly code: 'PATH_DENIED' | 'UNSUPPORTED_FILE'

  constructor(code: FileError['code'], message: string) {
    super(message)
    this.name = 'FileError'
    this.code = code
  }
}

export interface MemWorkspace extends Workspace {
  /** The file's text, or undefined when it does not exist. */
  get: (path: string) => string | undefined
  /** Changes a file the way an outside process would: new version, no check. undefined deletes it. */
  set: (path: string, content: string | Uint8Array | undefined) => void
}

/**
 * In memory, with a real compare-and-set: for tests and scripts. `identity` is what resolve returns; by default a path
 * is its own identity.
 */
export function memWorkspace(
  initial: Record<string, string | Uint8Array> = {},
  identity: (path: string) => string = path => path,
): MemWorkspace {
  const files = new Map<string, Snapshot>()
  const encoder = new TextEncoder()
  let generation = 0

  const set = (path: string, content: string | Uint8Array | undefined): void => {
    if (content === undefined) {
      files.delete(identity(path))
      return
    }
    const bytes = typeof content === 'string' ? encoder.encode(content) : content
    files.set(identity(path), { bytes, version: `m${++generation}` as Version })
  }

  for (const [path, content] of Object.entries(initial)) {
    set(path, content)
  }

  return {
    resolve: async path => identity(path),
    async read(path, signal) {
      signal.throwIfAborted()
      return files.get(identity(path))
    },
    async publish(path, expected, next, signal) {
      signal.throwIfAborted()
      if ((files.get(identity(path))?.version ?? 'absent') !== expected) {
        return 'stale'
      }
      set(path, next)
      return files.get(identity(path))!.version
    },
    get: path => {
      const file = files.get(identity(path))
      return file && new TextDecoder().decode(file.bytes)
    },
    set,
  }
}
