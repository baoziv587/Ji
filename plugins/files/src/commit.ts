// commit = publish ∘ f ∘ read (RFC §1). prepare is commit without the publish, so a check that fails never writes.

import type { Result } from './core/result.ts'
import type { EditError, Transform } from './transform.ts'
import type { Expected, Reader, Resolver, Version, Workspace } from './workspace.ts'
import { err, ok } from './core/result.ts'
import { decode, encode } from './core/view.ts'
import { FileError } from './workspace.ts'

export interface Prepared {
  /** The file's identity: workspace.resolve(path). */
  path: string
  /** The decoded file before, and after the transform. */
  base: string
  next: string
  /** The version `base` was read at. */
  expected: Expected
}

export interface Applied extends Prepared {
  /** The version publish wrote. */
  version: Version
}

/** Everything commit checks, without writing. The result is a preview, not a reservation: publish checks again. */
export async function prepare(
  workspace: Resolver & Reader,
  path: string,
  expected: Expected,
  f: Transform,
  signal: AbortSignal,
): Promise<Result<Prepared, EditError[]>> {
  try {
    const real = await workspace.resolve(path)
    const snapshot = await workspace.read(real, signal)
    const current = snapshot?.version ?? 'absent'
    if (current !== expected) {
      return err([{ code: 'STALE_VERSION', expected, current }])
    }

    const base = snapshot ? decode(snapshot.bytes) : ''
    if (base === undefined) {
      return err([{ code: 'UNSUPPORTED_FILE', message: `${path} is not a UTF-8 text file` }])
    }

    const next = f(base)
    if (!next.ok) {
      return next
    }
    if (!next.value.isWellFormed()) {
      return err([{ code: 'INVALID_INPUT', message: 'The new text must be valid Unicode.' }])
    }
    if (next.value === base) {
      return err([{ code: 'NO_CHANGE' }])
    }
    return ok({ path: real, base, next: next.value, expected })
  } catch (e) {
    return expectedFailure(e)
  }
}

export async function commit(
  workspace: Workspace,
  path: string,
  expected: Expected,
  f: Transform,
  signal: AbortSignal,
): Promise<Result<Applied, EditError[]>> {
  const prepared = await prepare(workspace, path, expected, f, signal)
  if (!prepared.ok) {
    return prepared
  }

  try {
    const version = await workspace.publish(prepared.value.path, expected, encode(prepared.value.next), signal)
    return version === 'stale' ? err([{ code: 'STALE_VERSION', expected }]) : ok({ ...prepared.value, version })
  } catch (e) {
    return expectedFailure(e)
  }
}

/** A FileError is a result for the model; anything else is rethrown, so retry middleware sees it. */
function expectedFailure(e: unknown): Result<never, EditError[]> {
  if (e instanceof FileError) {
    return err([{ code: e.code, message: e.message }])
  }
  throw e
}
