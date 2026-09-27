// before / after / intercept / mapEvents against a hand-written next, no model involved (RFC-0006 §4, appendix A.2–A.3).
import type { Stream } from '@gaoxiang.ai/kernel'
import type { Cancellable, Middleware } from './middleware.ts'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { after, before, intercept, mapEvents } from './middleware.ts'

type StringMiddleware = Middleware<string, string, Cancellable, string>

// fc.func hashes every argument it gets, so each is wrapped to take the value alone, as the fused side does.

describe('before', () => {
  it('should always compose inputs in list order', async () => {
    await fc.assert(
      fc.asyncProperty(fc.func(fc.string()), fc.func(fc.string()), fc.string(), async (f, g, input) => {
        // Arrange
        const nested: StringMiddleware[] = [before(x => f(x)), before(x => g(x))]
        const fused: StringMiddleware[] = [before(x => g(f(x)))]

        // Act
        const left = await runHelpers(nested, input)
        const right = await runHelpers(fused, input)

        // Assert
        expect(left).toEqual(right)
      }),
    )
  })

  it('should tell a reversed list apart', async () => {
    // Arrange
    const a: StringMiddleware = before(s => `${s}A`)
    const b: StringMiddleware = before(s => `${s}B`)

    // Act
    const ab = await runHelpers([a, b], '')
    const ba = await runHelpers([b, a], '')

    // Assert
    expect(ab.exit).toEqual({ tag: 'return', value: 'AB' })
    expect(ba.exit).toEqual({ tag: 'return', value: 'BA' })
  })

  it('should wait for an async callback and pass its ctx through', async () => {
    // Arrange
    const ctx = { signal: new AbortController().signal, suffix: '!' }
    const mw = before<string, string, typeof ctx, string>(async (s, { suffix }) => `${s}${suffix}`)

    // Act
    const run = await runHelpers([mw], 'a', ctx)

    // Assert
    expect(run).toEqual({ events: ['a!'], exit: { tag: 'return', value: 'a!' } })
  })

  it('should not start next when the step is cancelled while its callback is pending', async () => {
    // Arrange
    const ctl = new AbortController()
    const pending = Promise.withResolvers<string>()
    const mw: StringMiddleware = before(() => pending.promise)
    const starts = { count: 0 }

    // Act
    const running = runHelpers([mw], 'a', { signal: ctl.signal }, starts)
    ctl.abort(new Error('interrupted'))
    pending.resolve('late')
    const run = await running

    // Assert
    expect(starts.count).toBe(0)
    expect(run).toEqual({ events: [], exit: { tag: 'throw', error: new Error('interrupted') } })
  })

  it('should pass what its callback throws through unchanged', async () => {
    // Arrange
    const boom = new Error('boom')
    const mw: StringMiddleware = before(() => {
      throw boom
    })

    // Act
    const run = await runHelpers([mw], 'a')

    // Assert
    expect(run.exit).toEqual({ tag: 'throw', error: boom })
    expect(run.exit.tag === 'throw' && run.exit.error).toBe(boom)
  })
})

describe('after', () => {
  it('should always compose results inside out and keep the events', async () => {
    await fc.assert(
      fc.asyncProperty(fc.func(fc.string()), fc.func(fc.string()), fc.string(), async (f, g, input) => {
        // Arrange
        const nested: StringMiddleware[] = [after(x => f(x)), after(x => g(x))]
        const fused: StringMiddleware[] = [after(x => f(g(x)))]

        // Act
        const left = await runHelpers(nested, input)
        const right = await runHelpers(fused, input)

        // Assert
        expect(left).toEqual(right)
        expect(left.events).toEqual([input])
      }),
    )
  })

  it('should read the input and wait for an async callback', async () => {
    // Arrange
    const mw: StringMiddleware = after(async (out, input) => `${out.toUpperCase()} for ${input}`)

    // Act
    const run = await runHelpers([mw], 'a')

    // Assert
    expect(run).toEqual({ events: ['a'], exit: { tag: 'return', value: 'A for a' } })
  })

  it('should give no late result when the step is cancelled while its callback is pending', async () => {
    // Arrange
    const ctl = new AbortController()
    const pending = Promise.withResolvers<string>()
    const mw: StringMiddleware = after(() => pending.promise)

    // Act
    const running = runHelpers([mw], 'a', { signal: ctl.signal })
    await Promise.resolve()
    ctl.abort(new Error('interrupted'))
    pending.resolve('late')
    const run = await running

    // Assert
    expect(run.exit).toEqual({ tag: 'throw', error: new Error('interrupted') })
  })

  it('should pass an early return (cancellation) through to next', async () => {
    // Arrange
    const closed = { value: false }
    const passThrough: StringMiddleware = after(out => out)
    const stream = passThrough('a', base(closed), idle())

    // Act
    await stream.next()
    await stream.return(undefined as never)

    // Assert
    expect(closed.value).toBe(true)
  })
})

describe('intercept', () => {
  it('should always behave like next when it lets the input through', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async input => {
        // Arrange
        const pass: StringMiddleware = intercept(() => undefined)

        // Act
        const run = await runHelpers([pass], input)

        // Assert
        expect(run).toEqual(await runHelpers([], input))
      }),
    )
  })

  it('should always return its value without starting next when it intercepts', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), fc.string(), async (input, value) => {
        // Arrange
        const stop: StringMiddleware = intercept(() => value)
        const starts = { count: 0 }

        // Act
        const run = await runHelpers([stop], input, idle(), starts)

        // Assert
        expect(run).toEqual({ events: [], exit: { tag: 'return', value } })
        expect(starts.count).toBe(0)
      }),
    )
  })

  it('should wait for an async decision', async () => {
    // Arrange
    const deny: StringMiddleware = intercept(async s => (s === 'no' ? 'denied' : undefined))

    // Act
    const denied = await runHelpers([deny], 'no')
    const allowed = await runHelpers([deny], 'yes')

    // Assert
    expect(denied.exit).toEqual({ tag: 'return', value: 'denied' })
    expect(allowed.exit).toEqual({ tag: 'return', value: 'yes' })
  })

  it('should neither start next nor return when the step is cancelled while it decides', async () => {
    // Arrange
    const ctl = new AbortController()
    const pending = Promise.withResolvers<undefined>()
    const mw: StringMiddleware = intercept(() => pending.promise)
    const starts = { count: 0 }

    // Act
    const running = runHelpers([mw], 'a', { signal: ctl.signal }, starts)
    ctl.abort(new Error('interrupted'))
    pending.resolve(undefined)
    const run = await running

    // Assert
    expect(starts.count).toBe(0)
    expect(run.exit).toEqual({ tag: 'throw', error: new Error('interrupted') })
  })
})

describe('mapEvents', () => {
  it('should always compose like the functions it maps with and keep the result', async () => {
    await fc.assert(
      fc.asyncProperty(fc.func(fc.string()), fc.func(fc.string()), fc.string(), async (f, g, input) => {
        // Arrange
        const nested: StringMiddleware[] = [mapEvents(e => f(e)), mapEvents(e => g(e))]
        const fused: StringMiddleware[] = [mapEvents(e => f(g(e)))]

        // Act
        const left = await runHelpers(nested, input)
        const right = await runHelpers(fused, input)

        // Assert
        expect(left).toEqual(right)
        expect(left.exit).toEqual({ tag: 'return', value: input })
      }),
    )
  })

  it('should always commute with after, since one maps only events and the other only the result', async () => {
    await fc.assert(
      fc.asyncProperty(fc.func(fc.string()), fc.func(fc.string()), fc.string(), async (f, g, input) => {
        // Arrange
        const events: StringMiddleware = mapEvents(e => f(e))
        const result: StringMiddleware = after(r => g(r))

        // Act
        const left = await runHelpers([events, result], input)
        const right = await runHelpers([result, events], input)

        // Assert
        expect(left).toEqual(right)
      }),
    )
  })

  it('should pass an early return (cancellation) through to next', async () => {
    // Arrange
    const closed = { value: false }
    const passThrough: StringMiddleware = mapEvents(e => e)
    const stream = passThrough('a', base(closed), idle())

    // Act
    await stream.next()
    await stream.return(undefined as never)

    // Assert
    expect(closed.value).toBe(true)
  })
})

// Helpers

type Exit = { tag: 'return'; value: string } | { tag: 'throw'; error: unknown }

function idle(): Cancellable {
  return { signal: new AbortController().signal }
}

/** The innermost next: yields its input as one event and returns it; counts how often it starts. */
function base(closed = { value: false }, starts = { count: 0 }): (input: string) => Stream<string, string> {
  return input =>
    (async function* () {
      starts.count++
      try {
        yield input
        return input
      } finally {
        closed.value = true
      }
    })()
}

/** Runs the middleware from outer to inner over `base`, on a fresh stream, reading events and the final result. */
async function runHelpers<C extends Cancellable>(
  list: Array<Middleware<string, string, C, string>>,
  input: string,
  ctx: C = idle() as C,
  starts = { count: 0 },
): Promise<{ events: string[]; exit: Exit }> {
  const next = list.reduceRight<(i: string) => Stream<string, string>>(
    (inner, mw) => i => mw(i, inner, ctx),
    base(undefined, starts),
  )
  const stream = next(input)
  const events: string[] = []

  try {
    for (;;) {
      const r = await stream.next()
      if (r.done) {
        return { events, exit: { tag: 'return', value: r.value } }
      }
      events.push(r.value)
    }
  } catch (error) {
    return { events, exit: { tag: 'throw', error } }
  }
}
