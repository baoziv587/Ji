/**
 * Freezes plain objects and arrays all the way down, so writing to the value throws a TypeError at the line that does
 * it. A frozen subtree is skipped: it was frozen with everything below it, so repeated calls only walk what is new.
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

/** Structural equality over plain data: primitives, plain objects and arrays. */
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
