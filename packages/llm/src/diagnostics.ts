// Development checks and warnings (RFC-0006 §8). They report misuse; none of them changes what a correct run does.

export type WarningType = 'ObserveWarning' | 'DeterminismWarning'

/** On only when NODE_ENV is development or test; any other value, or none at all, leaves the checks off. */
export function checksByDefault(): boolean {
  const env = nodeProcess()?.env?.NODE_ENV
  return env === 'development' || env === 'test'
}

/** process.emitWarning in Node; console.error where there is no process (browsers). */
export function warn(message: string, type: WarningType): void {
  const node = nodeProcess()
  if (typeof node?.emitWarning === 'function') {
    node.emitWarning(message, type)
  } else {
    console.error(`${type}: ${message}`)
  }
}

/**
 * Freezes plain objects and arrays all the way down, so writing to committed state throws a TypeError at the line that
 * does it. A frozen subtree is skipped: it was frozen with everything below it, so each commit only walks what is new.
 * Class instances, Maps and Sets are left alone.
 */
export function deepFreeze<T>(value: T): T {
  if (!isPlainData(value) || Object.isFrozen(value)) {
    return value
  }

  Object.freeze(value)
  for (const child of Object.values(value)) {
    deepFreeze(child)
  }
  return value
}

/** Structural equality over what plugin state may hold: primitives, plain objects and arrays. */
export function sameData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true
  }
  if (!isPlainData(a) || !isPlainData(b) || Array.isArray(a) !== Array.isArray(b)) {
    return false
  }

  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) {
    return false
  }
  return keys.every(key => Object.hasOwn(b, key) && sameData(Reflect.get(a, key), Reflect.get(b, key)))
}

function isPlainData(value: unknown): value is object {
  if (Array.isArray(value)) {
    return true
  }
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

interface NodeProcess {
  env?: Record<string, string | undefined>
  emitWarning?: (message: string, type: string) => void
}

function nodeProcess(): NodeProcess | undefined {
  return Reflect.get(globalThis, 'process') as NodeProcess | undefined
}
