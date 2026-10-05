// runProcess and foldStream on createMemoryHost: the earliest clock (L4), nothing left running (L6), wrapHost (L6)
import type { Chunk, Outcome, Spec } from '../src/index.ts'
import fc from 'fast-check'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createHitsFold,
  createMemoryHost,
  foldStream,
  runProcess,
  streamResult,
  tapStream,
  wrapHost,
} from '../src/index.ts'

const DOT: Chunk = { fd: 1, text: '.' }
const SPEC: Spec = { argv: ['cmd'] }

afterEach(() => {
  vi.useRealTimers()
})

describe('runProcess (L4)', () => {
  it('should always end with the clock that fires first, or the exit when it comes before them', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          chunks: fc.nat(5),
          gap: fc.integer({ min: 1, max: 50 }),
          hangs: fc.boolean(),
          total: fc.integer({ min: 1, max: 300 }),
          idle: fc.option(fc.integer({ min: 1, max: 100 }), { nil: undefined }),
        }),
        async ({ chunks, gap, hangs, total, idle }) => {
          // Arrange: when each would end it; output does not reset the total clock, and does reset the idle one
          const exitAt = hangs ? Infinity : chunks * gap
          let idleAt = Infinity
          if (idle !== undefined && chunks > 0 && gap > idle) {
            idleAt = idle
          } else if (idle !== undefined && hangs) {
            idleAt = chunks * gap + idle
          }
          const first = Math.min(total, idleAt, exitAt)
          fc.pre([total, idleAt, exitAt].filter(at => at === first).length === 1 && gap !== idle)

          let expected: Outcome = { kind: 'exit', code: 3 }
          if (first === total) {
            expected = { kind: 'timeout', clock: 'total', ms: total }
          } else if (first === idleAt) {
            expected = { kind: 'timeout', clock: 'idle', ms: idle! }
          }

          vi.useFakeTimers()
          const host = createMemoryHost(() => ({
            chunks: Array.from<Chunk>({ length: chunks }).fill(DOT),
            gapMs: gap,
            hangs,
            exit: { kind: 'exit', code: 3 },
          }))

          // Act
          const ended = streamResult(runProcess(host, SPEC, { totalMs: total, idleMs: idle }, never()))
          await vi.runAllTimersAsync()

          // Assert
          expect(await ended).toEqual(expected)
          expect(host.running).toBe(0)
          vi.useRealTimers()
        },
      ),
    )
  })

  it('should give a nonzero exit as the outcome even with nothing on stderr (probe E3)', async () => {
    // Arrange
    const host = createMemoryHost(() => ({ exit: { kind: 'exit', code: 7 } }))

    // Act
    const outcome = await streamResult(runProcess(host, SPEC, {}, never()))

    // Assert
    expect(outcome).toEqual({ kind: 'exit', code: 7 })
  })

  it('should throw when the step is cancelled, and leave nothing running', async () => {
    // Arrange
    const host = createMemoryHost(() => ({ hangs: true }))
    const cancel = new AbortController()

    // Act
    const ended = streamResult(runProcess(host, SPEC, { totalMs: 10_000 }, cancel.signal))
    cancel.abort(new Error('cancelled'))

    // Assert
    await expect(ended).rejects.toThrow('cancelled')
    expect(host.running).toBe(0)
  })
})

describe('closing (L6)', () => {
  it('should stop the process when the consumer closes the stream', async () => {
    // Arrange
    const host = createMemoryHost(() => ({ chunks: [DOT, DOT], hangs: true }))
    const stream = runProcess(host, SPEC, {}, never())

    // Act
    await stream.next()
    await stream.return(undefined as never)

    // Assert
    expect(host.running).toBe(0)
  })

  it('should stop the process once the fold is full, without waiting for it', async () => {
    // Arrange: two matches and a limit of one, then a search that never ends
    const event = (line: number): string =>
      `${JSON.stringify({ type: 'match', data: { path: { text: 'a' }, lines: { text: 'x\n' }, line_number: line } })}\n`
    const host = createMemoryHost(() => ({ chunks: [{ fd: 1, text: event(1) + event(2) }], hangs: true }))

    // Act
    const [found, end] = await streamResult(foldStream(runProcess(host, SPEC, {}, never()), createHitsFold(1, 100)))

    // Assert
    expect(found.matches).toBe(2)
    expect(end).toBeUndefined()
    expect(host.running).toBe(0)
  })

  it('should show every chunk to a tap before passing it on', async () => {
    // Arrange
    const host = createMemoryHost(() => ({
      chunks: [
        { fd: 1, text: 'a' },
        { fd: 2, text: 'b' },
      ],
    }))
    const seen: string[] = []

    // Act
    const outcome = await streamResult(tapStream(runProcess(host, SPEC, {}, never()), c => seen.push(c.text)))

    // Assert
    expect(seen).toEqual(['a', 'b'])
    expect(outcome).toEqual({ kind: 'exit', code: 0 })
  })
})

describe('wrapHost (L6)', () => {
  it('should apply the inner rewrite last: wrapHost(wrapHost(h, f), g) = wrapHost(h, f ∘ g)', async () => {
    const prefix = fc.array(fc.string(), { maxLength: 3 })
    await fc.assert(
      fc.asyncProperty(prefix, prefix, async (fArgs, gArgs) => {
        // Arrange
        const f = (spec: Spec): Spec => ({ ...spec, argv: [...fArgs, ...spec.argv] })
        const g = (spec: Spec): Spec => ({ ...spec, argv: [...gArgs, ...spec.argv] })
        const nested = createMemoryHost(() => ({}))
        const composed = createMemoryHost(() => ({}))

        // Act
        await streamResult(wrapHost(wrapHost(nested, f), g).spawn(SPEC, never()))
        await streamResult(wrapHost(composed, s => f(g(s))).spawn(SPEC, never()))

        // Assert
        expect(nested.specs).toEqual(composed.specs)
        expect(nested.specs[0].argv).toEqual([...fArgs, ...gArgs, 'cmd'])
      }),
    )
  })
})

function never(): AbortSignal {
  return new AbortController().signal
}
