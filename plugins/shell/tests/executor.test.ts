// runWithClocks and foldStream on createMemoryExecutor: the earliest clock (L4), nothing left running (L6)
import type { Chunk, Outcome } from '../src/index.ts'
import fc from 'fast-check'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHitsFold, createMemoryExecutor, foldStream, streamResult, tapStream } from '../src/index.ts'

const DOT: Chunk = { fd: 1, text: '.' }
const COMMAND = 'cmd'

afterEach(() => {
  vi.useRealTimers()
})

describe('runWithClocks (L4)', () => {
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
          const executor = createMemoryExecutor(() => ({
            chunks: Array.from<Chunk>({ length: chunks }).fill(DOT),
            gapMs: gap,
            hangs,
            exit: { kind: 'exit', code: 3 },
          }))

          // Act
          const ended = streamResult(executor.execute(COMMAND, { signal: never(), timeoutMs: total, idleMs: idle }))
          await vi.runAllTimersAsync()

          // Assert
          expect(await ended).toEqual(expected)
          expect(executor.running).toBe(0)
          vi.useRealTimers()
        },
      ),
    )
  })

  it('should give a nonzero exit as the outcome even with nothing on stderr (probe E3)', async () => {
    // Arrange
    const executor = createMemoryExecutor(() => ({ exit: { kind: 'exit', code: 7 } }))

    // Act
    const outcome = await streamResult(executor.execute(COMMAND, { signal: never() }))

    // Assert
    expect(outcome).toEqual({ kind: 'exit', code: 7 })
  })

  it('should throw when the step is cancelled, and leave nothing running', async () => {
    // Arrange
    const executor = createMemoryExecutor(() => ({ hangs: true }))
    const cancel = new AbortController()

    // Act
    const ended = streamResult(executor.execute(COMMAND, { signal: cancel.signal, timeoutMs: 10_000 }))
    cancel.abort(new Error('cancelled'))

    // Assert
    await expect(ended).rejects.toThrow('cancelled')
    expect(executor.running).toBe(0)
  })
})

describe('closing (L6)', () => {
  it('should stop the process when the consumer closes the stream', async () => {
    // Arrange
    const executor = createMemoryExecutor(() => ({ chunks: [DOT, DOT], hangs: true }))
    const stream = executor.execute(COMMAND, { signal: never() })

    // Act
    await stream.next()
    await stream.return(undefined as never)

    // Assert
    expect(executor.running).toBe(0)
  })

  it('should stop the process once the fold is full, without waiting for it', async () => {
    // Arrange: two matches and a limit of one, then a search that never ends
    const event = (line: number): string =>
      `${JSON.stringify({ type: 'match', data: { path: { text: 'a' }, lines: { text: 'x\n' }, line_number: line } })}\n`
    const executor = createMemoryExecutor(() => ({ chunks: [{ fd: 1, text: event(1) + event(2) }], hangs: true }))

    // Act
    const [found, end] = await streamResult(
      foldStream(executor.execute(COMMAND, { signal: never() }), createHitsFold(1, 100)),
    )

    // Assert
    expect(found.matches).toBe(2)
    expect(end).toBeUndefined()
    expect(executor.running).toBe(0)
  })

  it('should show every chunk to a tap before passing it on', async () => {
    // Arrange
    const executor = createMemoryExecutor(() => ({
      chunks: [
        { fd: 1, text: 'a' },
        { fd: 2, text: 'b' },
      ],
    }))
    const seen: string[] = []

    // Act
    const outcome = await streamResult(
      tapStream(executor.execute(COMMAND, { signal: never() }), c => seen.push(c.text)),
    )

    // Assert
    expect(seen).toEqual(['a', 'b'])
    expect(outcome).toEqual({ kind: 'exit', code: 0 })
  })
})

function never(): AbortSignal {
  return new AbortController().signal
}
