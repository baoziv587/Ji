// commit = prepare, then publish (RFC §5.4). prepare does no writing, so a check that fails never reaches publish.

import type { Batch } from './core/batch.ts'
import type { Edit, PlanError } from './core/plan.ts'
import type { Result } from './core/result.ts'
import type { Expected, Reader, Store, Version } from './store.ts'
import { apply, rewrite } from './core/batch.ts'
import { plan } from './core/plan.ts'
import { err, ok } from './core/result.ts'
import { decode, encode, view } from './core/view.ts'

/** Builds the batch to apply to the decoded file; '' when it does not exist. */
export type Transform = (raw: string) => Result<Batch, PlanError[]>

export type EditError =
  | PlanError
  | { code: 'NO_CHANGE' }
  | { code: 'NOT_OBSERVED' }
  | { code: 'STALE_VERSION'; expected: Expected; current?: Version }
  | { code: 'UNSUPPORTED_FILE' | 'PATH_DENIED'; message: string }

export interface Prepared {
  path: string
  /** The decoded file before, and after the batch. */
  base: string
  next: string
  batch: Batch
  version: Expected
}

export type Outcome =
  | { state: 'applied'; prepared: Prepared; version: Version }
  | { state: 'not_applied'; errors: EditError[] }
  | { state: 'unknown'; prepared: Prepared; error: unknown }

export function editTransform(edits: readonly Edit[]): Transform {
  return raw => plan(view(raw), edits)
}

export function writeTransform(content: string): Transform {
  return raw =>
    content.isWellFormed()
      ? ok(rewrite(raw, content))
      : err([{ code: 'INVALID_INPUT', message: 'content must be valid Unicode' }])
}

/** Everything commit checks, without writing. The result is a preview, not a reservation: publish checks again. */
export async function prepare(
  reader: Reader,
  path: string,
  expected: Expected,
  f: Transform,
  signal: AbortSignal,
): Promise<Result<Prepared, EditError[]>> {
  const snapshot = await reader.read(path, signal)
  const version = snapshot?.version ?? 'absent'
  if (version !== expected) {
    return err([{ code: 'STALE_VERSION', expected, current: snapshot?.version }])
  }

  const base = snapshot ? decode(snapshot.bytes) : ''
  if (base === undefined) {
    return err([{ code: 'UNSUPPORTED_FILE', message: `${path} is not a UTF-8 text file` }])
  }

  const planned = f(base)
  if (!planned.ok) {
    return planned
  }
  const next = apply(base, planned.value)
  if (next === base) {
    return err([{ code: 'NO_CHANGE' }])
  }
  return ok({ path, base, next, batch: planned.value, version })
}

export async function commit(
  store: Store,
  path: string,
  expected: Expected,
  f: Transform,
  signal: AbortSignal,
): Promise<Outcome> {
  const prepared = await prepare(store, path, expected, f, signal)
  if (!prepared.ok) {
    return { state: 'not_applied', errors: prepared.error }
  }

  const c = await store.publish(path, expected, encode(prepared.value.next), signal)
  switch (c.state) {
    case 'applied':
      return { state: 'applied', prepared: prepared.value, version: c.version }
    case 'stale':
      return { state: 'not_applied', errors: [{ code: 'STALE_VERSION', expected, current: c.current }] }
    case 'unknown':
      return { state: 'unknown', prepared: prepared.value, error: c.error }
  }
}
