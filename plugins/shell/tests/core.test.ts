// The pure core: the window monoid (L1), chunking independence (L2), the argv injection (L3) and the hits fold (L5)
import type { Chunk, Query } from '../src/index.ts'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  createHitsFold,
  createOutputFold,
  createWindow,
  foldStream,
  omittedLines,
  parseRipgrepEvent,
  ripgrepArgs,
  streamResult,
  truncateLine,
} from '../src/index.ts'

const line = fc.constantFrom('a', 'bb', '', 'é', '😀', 'x'.repeat(12))
const lines = fc.array(line, { maxLength: 30 })
const size = fc.nat(6)

// Pieces of output that cover what L2 names: CRLF, astral characters, long lines, and empty lines
const piece = fc.constantFrom('a', 'é', '😀', '\n', '\r\n', '\r', 'x'.repeat(9))
const output = fc.array(piece, { maxLength: 60 }).map(pieces => pieces.join(''))

describe('createWindow (L1)', () => {
  it('should clip a sequence the same as it clips its two halves and joins them', () => {
    fc.assert(
      fc.property(size, size, lines, lines, (h, t, xs, ys) => {
        // Arrange
        const w = createWindow(h, t)

        // Act
        const joined = w.concat(w.of(xs), w.of(ys))

        // Assert
        expect(joined).toEqual(w.of([...xs, ...ys]))
      }),
    )
  })

  it('should have empty as its unit, and join in any grouping alike', () => {
    fc.assert(
      fc.property(size, size, lines, lines, lines, (h, t, xs, ys, zs) => {
        // Arrange
        const w = createWindow(h, t)
        const [a, b, c] = [w.of(xs), w.of(ys), w.of(zs)]

        // Assert
        expect(w.concat(w.empty, a)).toEqual(a)
        expect(w.concat(a, w.empty)).toEqual(a)
        expect(w.concat(w.concat(a, b), c)).toEqual(w.concat(a, w.concat(b, c)))
      }),
    )
  })

  it('should keep at most H and T lines, and account for every line it drops', () => {
    fc.assert(
      fc.property(size, size, fc.array(lines, { maxLength: 6 }), (h, t, pieces) => {
        // Arrange
        const w = createWindow(h, t)

        // Act
        const clip = pieces.map(w.of).reduce(w.concat, w.empty)

        // Assert
        expect(clip.head.length).toBeLessThanOrEqual(h)
        expect(clip.tail.length).toBeLessThanOrEqual(t)
        expect(clip.head.length + clip.tail.length + omittedLines(clip)).toBe(clip.total)
        expect(clip.total).toBe(pieces.flat().length)
      }),
    )
  })

  it('should drop nothing when there are exactly H + T lines, or when H or T is 0 and the other covers them', () => {
    // Arrange
    const ten = Array.from({ length: 10 }, (_, i) => String(i))

    // Act
    const exact = createWindow(4, 6).of(ten)
    const headOnly = createWindow(10, 0).of(ten)
    const tailOnly = createWindow(0, 3).of(ten)

    // Assert
    expect(exact).toEqual({ head: ['0', '1', '2', '3'], tail: ['4', '5', '6', '7', '8', '9'], total: 10 })
    expect(omittedLines(headOnly)).toBe(0)
    expect(tailOnly).toEqual({ head: [], tail: ['7', '8', '9'], total: 10 })
  })
})

describe('createOutputFold (L2)', () => {
  it('should keep the same lines however the output is cut into chunks, as if it had been read whole', () => {
    fc.assert(
      fc.property(
        output,
        fc.array(fc.nat(), { maxLength: 8 }),
        size,
        size,
        fc.integer({ min: 1, max: 6 }),
        (text, cuts, h, t, lineChars) => {
          // Arrange
          const fold = createOutputFold({ headLines: h, tailLines: t, lineChars })
          const whole = text.split('\n')
          const last = whole.pop()!
          const expected = createWindow(h, t).of(
            [...whole, ...(last === '' ? [] : [last])].map(l => truncateLine(l, lineChars)),
          )

          // Act
          const kept = cut(text, cuts)
            .map((s): Chunk => ({ fd: 1, text: s }))
            .reduce(fold.step, fold.empty)

          // Assert
          expect(fold.close(kept)).toEqual(expected)
        },
      ),
    )
  })

  it('should never join a line of stdout with a line of stderr', () => {
    // Arrange
    const fold = createOutputFold({ headLines: 10, tailLines: 0, lineChars: 100 })
    const chunks: Chunk[] = [
      { fd: 1, text: 'compiling ' },
      { fd: 2, text: 'warning: deprecated\n' },
      { fd: 1, text: 'done\nexit' },
    ]

    // Act
    const clip = fold.close(chunks.reduce(fold.step, fold.empty))

    // Assert
    expect(clip.head).toEqual(['warning: deprecated', 'compiling done', 'exit'])
  })
})

describe('truncateLine', () => {
  it('should keep the start of a long line and say how many characters are missing', () => {
    expect(truncateLine('abcdef', 4)).toBe('abcd … [+2 chars]')
    expect(truncateLine('abcd\r', 4)).toBe('abcd')
  })

  it('should never cut a surrogate pair in half', () => {
    expect(truncateLine('ab😀cd', 3)).toBe('ab … [+4 chars]')
  })
})

describe('ripgrepArgs (L3)', () => {
  const options = fc.record({
    literal: fc.boolean(),
    ignoreCase: fc.boolean(),
    context: fc.nat(10),
    glob: fc.boolean(),
  })
  const values = fc.record({ pattern: fc.string(), path: fc.string({ minLength: 1 }), glob: fc.string() })
  type Options = typeof options extends fc.Arbitrary<infer O> ? O : never
  type Values = typeof values extends fc.Arbitrary<infer V> ? V : never
  const query = (o: Options, v: Values): Query => ({ ...o, ...v, glob: o.glob ? v.glob : undefined })

  it('should make every value one argument: the array has the same shape whatever the values say', () => {
    fc.assert(
      fc.property(options, values, values, (o, a, b) => {
        // Act
        const args = ripgrepArgs(query(o, a))

        // Assert
        expect(args).toHaveLength(ripgrepArgs(query(o, b)).length)
        expect(args).toContain(`--regexp=${a.pattern}`)
        expect(args.slice(-2)).toEqual(['--', a.path])
      }),
    )
  })

  it('should pass a pattern that looks like a command or an option as the pattern (scenario 2.5)', () => {
    expect(ripgrepArgs({ pattern: '$(printf PROBE_MARKER)', path: '.', literal: true })).toEqual([
      '--json',
      '--no-config',
      '--hidden',
      '--glob=!.git',
      '--fixed-strings',
      '--regexp=$(printf PROBE_MARKER)',
      '--',
      '.',
    ])
    expect(ripgrepArgs({ pattern: '-e', path: '-rf' }).slice(-3)).toEqual(['--regexp=-e', '--', '-rf'])
  })
})

describe('createHitsFold (L5)', () => {
  const event = fc.record({ match: fc.boolean(), line: fc.integer({ min: 1, max: 999 }) })

  it('should say there are more only after seeing the match after the limit, and close the stream there', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(event, { maxLength: 12 }),
        fc.integer({ min: 1, max: 5 }),
        fc.array(fc.nat(), { maxLength: 6 }),
        async (events, limit, cuts) => {
          // Arrange
          const text = events
            .map(e => rgEvent(e.match ? 'match' : 'context', 'src/a.ts', e.line, `line ${e.line}`))
            .join('')
          const stream = trackedStream(cut(text, cuts).map((s): Chunk => ({ fd: 1, text: s })))

          // Act
          const [found, end] = await streamResult(foldStream(stream, createHitsFold(limit, 100)))

          // Assert
          const matches = events.filter(e => e.match).length
          const more = matches > limit
          const keptMatches = found.hits.filter(h => h.match)
          expect(found.matches > limit).toBe(more)
          expect(keptMatches.map(h => h.line)).toEqual(
            events
              .filter(e => e.match)
              .slice(0, limit)
              .map(e => e.line),
          )
          expect(end === undefined).toBe(more)
          expect(stream.closed()).toBe(true)
        },
      ),
    )
  })

  it('should report exactly limit matches as all there are', async () => {
    // Arrange
    const text = [1, 2].map(n => rgEvent('match', 'a.ts', n, 'TODO')).join('')

    // Act
    const [found, end] = await streamResult(foldStream(trackedStream([{ fd: 1, text }]), createHitsFold(2, 100)))

    // Assert
    expect(found.matches).toBe(2)
    expect(end).toBe('exited')
  })

  it('should keep the place of a long line and say how much of it is missing (X8)', () => {
    // Act
    const hit = parseRipgrepEvent(rgEvent('match', 'dist/app.min.js', 1, 'x'.repeat(500)).trim(), 300)

    // Assert
    expect(hit).toEqual({ path: 'dist/app.min.js', line: 1, text: `${'x'.repeat(300)} … [+200 chars]`, match: true })
  })

  it('should decode text that ripgrep sends as bytes, and skip every other event', () => {
    // Arrange
    const bytes = JSON.stringify({
      type: 'match',
      data: { path: { bytes: btoa('aÿ.txt') }, lines: { text: 'hit\r\n' }, line_number: 3 },
    })

    // Assert
    expect(parseRipgrepEvent(bytes, 100)).toMatchObject({ line: 3, text: 'hit' })
    expect(parseRipgrepEvent('{"type":"begin","data":{}}', 100)).toBeUndefined()
    expect(parseRipgrepEvent('not json', 100)).toBeUndefined()
  })
})

// Helpers

/** The text cut at these positions, in chunks that join back into it. */
function cut(text: string, at: number[]): string[] {
  const positions = [...new Set(at.map(n => n % (text.length + 1)))].toSorted((a, b) => a - b)
  return [0, ...positions].map((from, i) => text.slice(from, positions[i] ?? text.length)).filter(s => s !== '')
}

/** One line of `rg --json`. */
function rgEvent(type: 'match' | 'context', path: string, line: number, text: string): string {
  return `${JSON.stringify({ type, data: { path: { text: path }, lines: { text: `${text}\n` }, line_number: line } })}\n`
}

/** A stream of these chunks ending in 'exited', that remembers whether it was closed. */
function trackedStream(chunks: Chunk[]): AsyncGenerator<Chunk, string, unknown> & { closed: () => boolean } {
  let closed = false
  async function* stream(): AsyncGenerator<Chunk, string, unknown> {
    try {
      yield* chunks
      return 'exited'
    } finally {
      closed = true
    }
  }
  return Object.assign(stream(), { closed: () => closed })
}
