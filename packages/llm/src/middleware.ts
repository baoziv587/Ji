import type { Stream } from '@ji.dev/kernel'
import type { Payload } from './types.ts'
import { mapYield } from '@ji.dev/kernel'

/** What the helpers read from a hook's ctx: the step's signal, checked after every async callback (RFC-0006 §3.5). */
export interface Cancellable {
  readonly signal: AbortSignal
}

/**
 * A streaming hook: decide, request, toolCalls or toolCall. The helpers below build one without writing a generator;
 * their callbacks' results are NoInfer, so the hook the helper is assigned to decides the types (stop(state) is a
 * Step<never, …>, yet still fits decide).
 */
export type Middleware<I, O, C extends Cancellable = Cancellable, D = Payload> = (
  input: I,
  next: (input: I) => Stream<D, O>,
  ctx: C,
) => Stream<D, O>

/** Changes the input, then calls next with it. `f` may be async; next does not start if the step is cancelled first. */
export function before<I, O, C extends Cancellable = Cancellable, D = Payload>(
  f: (input: I, ctx: C) => NoInfer<I> | Promise<NoInfer<I>>,
): Middleware<I, O, C, D> {
  return async function* (input, next, ctx) {
    const changed = await f(input, ctx)
    ctx.signal.throwIfAborted()

    return yield* next(changed)
  }
}

/**
 * Events pass through untouched; `g` maps only the final result, and may be async. Events already forwarded stay as
 * they were: to change what readers see, add mapEvents.
 */
export function after<I, O, C extends Cancellable = Cancellable, D = Payload>(
  g: (output: O, input: I, ctx: C) => NoInfer<O> | Promise<NoInfer<O>>,
): Middleware<I, O, C, D> {
  return async function* (input, next, ctx) {
    const output = yield* next(input)
    const changed = await g(output, input, ctx)
    ctx.signal.throwIfAborted()

    return changed
  }
}

/**
 * Returning a value makes it the result, and next never runs; returning undefined lets the input through as it is.
 * None of the four streaming hooks can produce undefined, so it never means anything else.
 */
export function intercept<I, O, C extends Cancellable = Cancellable, D = Payload>(
  f: (input: I, ctx: C) => NoInfer<O> | undefined | Promise<NoInfer<O> | undefined>,
): Middleware<I, O, C, D> {
  return async function* (input, next, ctx) {
    const output = await f(input, ctx)
    ctx.signal.throwIfAborted()

    if (output !== undefined) {
      return output
    }
    return yield* next(input)
  }
}

/**
 * Maps every event one to one, synchronously; the final result is untouched.
 * This changes only what readers see. To change the stored message as well, add `after`.
 */
export function mapEvents<I, O, C extends Cancellable = Cancellable, D = Payload>(
  f: (event: D, input: I, ctx: C) => D,
): Middleware<I, O, C, D> {
  return (input, next, ctx) => mapYield(next(input), event => f(event, input, ctx))
}
