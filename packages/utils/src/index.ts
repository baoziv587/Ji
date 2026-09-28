// @ji.dev/utils: general-purpose helpers with no dependencies and nothing agent-specific
//
//   A helper belongs here when its signature names no kernel, pi-ai or llm type and it upholds none of their
//   invariants. Reducers and stream combinators belong in @ji.dev/kernel instead.

export { duplicatesBy } from './collection.ts'
export { deepFreeze, sameData } from './data.ts'
export { errorMessage } from './error.ts'
export { isAsyncIterable, isThenable } from './guards.ts'
export { isDevEnv, warn } from './runtime.ts'
export { closest, editDistance } from './string.ts'
