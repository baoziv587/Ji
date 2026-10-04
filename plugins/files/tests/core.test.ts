// The pure core: the splice monoid (L1), order independence of plan (L2) and byte preservation (L3)
import type { Splice } from '../src/core/batch.ts'
import type { Edit, PlanError } from '../src/core/plan.ts'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { apply, batch, separable } from '../src/core/batch.ts'
import { plan } from '../src/core/plan.ts'
import { decode, encode, view } from '../src/core/view.ts'

// Pieces of text that cover the cases the view must keep: CRLF and LF, multi-byte and astral characters
const piece = fc.constantFrom('a', 'b', 'c', ' ', '\t', '\n', '\r\n', 'é', '😀')
const raw = fc
  .tuple(fc.boolean(), fc.array(piece, { maxLength: 40 }))
  .map(([bom, pieces]) => (bom ? '﻿' : '') + pieces.join(''))

/** Any splices on a text of this length, separable or not. */
function splices(length: number): fc.Arbitrary<Splice[]> {
  return fc.array(
    fc
      .tuple(fc.nat(length), fc.nat(length), fc.string({ maxLength: 3 }))
      .map(([a, b, text]) => ({ start: Math.min(a, b), end: Math.max(a, b), text })),
    { maxLength: 6 },
  )
}

describe('batch (L1)', () => {
  it('should join exactly when every pair of splices is separable', () => {
    fc.assert(
      fc.property(splices(20), ss => {
        // Act
        const joined = batch(ss)

        // Assert
        const pairwise = ss.every((a, i) => ss.every((b, j) => i === j || separable(a, b)))
        expect(joined.ok).toBe(pairwise)
      }),
    )
  })

  it('should give the same batch whatever order the splices come in', () => {
    fc.assert(
      fc.property(splices(20), splices(20), (a, b) => {
        // Act
        const ab = batch([...a, ...b])
        const ba = batch([...b, ...a])

        // Assert
        expect(ab.ok).toBe(ba.ok)
        if (ab.ok && ba.ok) {
          expect(ab.value).toEqual(ba.value)
        }
      }),
    )
  })

  it('should treat the empty batch as the unit', () => {
    fc.assert(
      fc.property(raw, text => {
        // Arrange
        const empty = batch([])

        // Assert
        expect(empty.ok && apply(text, empty.value)).toBe(text)
      }),
    )
  })

  it('should report every overlapping pair, not just the first', () => {
    // Arrange
    const ss = [
      { start: 0, end: 4, text: '' },
      { start: 2, end: 6, text: '' },
      { start: 3, end: 5, text: '' },
    ]

    // Act
    const joined = batch(ss)

    // Assert
    expect(joined.ok ? [] : joined.error).toEqual([
      [0, 1],
      [0, 2],
      [1, 2],
    ])
  })

  it('should allow adjacent replacements but not two inserts at one point', () => {
    // Act
    const adjacent = batch([
      { start: 0, end: 2, text: 'x' },
      { start: 2, end: 4, text: 'y' },
    ])
    const inserts = batch([
      { start: 2, end: 2, text: 'x' },
      { start: 2, end: 2, text: 'y' },
    ])

    // Assert
    expect(adjacent.ok).toBe(true)
    expect(inserts.ok).toBe(false)
  })
})

describe('plan (L2)', () => {
  const text = fc.array(fc.constantFrom('a', 'b', '\n'), { maxLength: 30 }).map(p => p.join(''))
  const edit = (t: string): fc.Arbitrary<Edit> =>
    fc.record(
      {
        old_text: fc.oneof(
          fc.tuple(fc.nat(t.length), fc.nat(4)).map(([at, n]) => t.slice(at, at + n + 1)),
          fc.string({ unit: fc.constantFrom('a', 'b', '\n'), minLength: 1, maxLength: 3 }),
        ),
        new_text: fc.string({ unit: fc.constantFrom('x', 'y', '\n'), maxLength: 3 }),
        count: fc.option(fc.integer({ min: 1, max: 3 }), { nil: undefined }),
      },
      { requiredKeys: ['old_text', 'new_text'] },
    )

  it('should give the same result for any order of the edits, with error indices renamed along', () => {
    fc.assert(
      fc.property(
        text
          .chain(t => fc.tuple(fc.constant(t), fc.array(edit(t), { minLength: 1, maxLength: 5 })))
          .chain(([t, es]) =>
            fc.tuple(fc.constant(t), fc.constant(es), fc.shuffledSubarray([...es.keys()], { minLength: es.length })),
          ),
        ([t, es, order]) => {
          // Act
          const planned = plan(view(t), es)
          const permuted = plan(
            view(t),
            order.map(i => es[i]),
          )

          // Assert
          expect(permuted.ok).toBe(planned.ok)
          if (planned.ok && permuted.ok) {
            expect(permuted.value).toEqual(planned.value)
          } else if (!planned.ok && !permuted.ok) {
            expect(normalized(permuted.error, i => order[i])).toEqual(normalized(planned.error, i => i))
          }
        },
      ),
    )
  })

  it('should match every edit against the original text, not the output of an earlier edit', () => {
    // Act
    const planned = plan(view('a b'), [
      { old_text: 'a', new_text: 'b' },
      { old_text: 'b', new_text: 'c' },
    ])

    // Assert
    expect(planned.ok && apply('a b', planned.value)).toBe('b c')
  })

  it('should report a target that occurs more than once, with its lines', () => {
    // Act
    const planned = plan(view('return null;\nx\nreturn null;\n'), [{ old_text: 'return null;', new_text: 'throw e;' }])

    // Assert
    expect(planned.ok ? [] : planned.error).toEqual([
      { code: 'MATCH_COUNT', edit: 0, expected: 1, found: 2, lines: [1, 3] },
    ])
  })

  it('should count overlapping occurrences, and reject replacing them', () => {
    // Act
    const unique = plan(view('aaa'), [{ old_text: 'aa', new_text: 'b' }])
    const both = plan(view('aaa'), [{ old_text: 'aa', new_text: 'b', count: 2 }])

    // Assert
    expect(unique.ok ? [] : unique.error).toMatchObject([{ code: 'MATCH_COUNT', found: 2 }])
    expect(both.ok ? [] : both.error).toEqual([{ code: 'OVERLAP', edits: [0, 0] }])
  })

  it('should report overlaps between edits along with the edits that did not match', () => {
    // Act
    const planned = plan(view('abcd'), [
      { old_text: 'abc', new_text: '1' },
      { old_text: 'zz', new_text: '2' },
      { old_text: 'bcd', new_text: '3' },
    ])

    // Assert
    expect(planned.ok ? [] : planned.error.map(e => e.code)).toEqual(['MATCH_COUNT', 'OVERLAP'])
  })

  it('should reject an empty old_text, invalid Unicode and a count that is not a positive integer', () => {
    // Act
    const planned = plan(view('abc'), [
      { old_text: '', new_text: 'x' },
      { old_text: 'a', new_text: '\uD800' },
      { old_text: 'b', new_text: 'x', count: 0 },
    ])

    // Assert
    expect(planned.ok ? [] : planned.error.map(e => [e.code, 'edit' in e && e.edit])).toEqual([
      ['INVALID_INPUT', 0],
      ['INVALID_INPUT', 1],
      ['INVALID_INPUT', 2],
    ])
  })
})

describe('view (L3)', () => {
  it('should change only the replaced text, whatever the BOM, line endings and characters around it', () => {
    fc.assert(
      fc.property(
        raw,
        fc.nat(),
        fc.string({ unit: fc.constantFrom('x', 'y'), maxLength: 3 }),
        (text, at, replacement) => {
          // Arrange: a marker that occurs nowhere else, placed between two pieces so it never splits a CRLF
          const pieces = text.split(/(?=\r\n)|(?<=\r\n)/)
          const cut = at % (pieces.length + 1)
          const marked = [...pieces.slice(0, cut), '§', ...pieces.slice(cut)].join('')

          // Act
          const planned = plan(view(marked), [{ old_text: '§', new_text: replacement }])

          // Assert
          expect(planned.ok && apply(marked, planned.value)).toBe(marked.replace('§', replacement))
        },
      ),
    )
  })

  it('should match LF in old_text against CRLF in the file and write new lines as CRLF', () => {
    // Arrange
    const text = 'a\r\nb\r\nc\r\n'

    // Act
    const planned = plan(view(text), [{ old_text: 'b\n', new_text: 'x\ny\n' }])

    // Assert
    expect(planned.ok && apply(text, planned.value)).toBe('a\r\nx\r\ny\r\nc\r\n')
  })

  it("should use the file's most common line ending when the replaced text has none, and LF on a tie", () => {
    // Act
    const mostlyCrlf = plan(view('a\r\nb\r\nc\n'), [{ old_text: 'b', new_text: 'x\ny' }])
    const tie = plan(view('a\r\nb\nc'), [{ old_text: 'c', new_text: 'x\ny' }])

    // Assert
    expect(mostlyCrlf.ok && apply('a\r\nb\r\nc\n', mostlyCrlf.value)).toBe('a\r\nx\r\ny\r\nc\n')
    expect(tie.ok && apply('a\r\nb\nc', tie.value)).toBe('a\r\nb\nx\ny')
  })

  it('should keep the BOM when the first characters are replaced', () => {
    // Act
    const planned = plan(view('﻿ab'), [{ old_text: 'a', new_text: 'z' }])

    // Assert
    expect(planned.ok && apply('﻿ab', planned.value)).toBe('﻿zb')
  })
})

describe('decode', () => {
  it('should give back the exact bytes of any valid text', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme' }), s => {
        // Arrange
        const text = s.replaceAll('\0', '')

        // Act
        const bytes = encode(text)

        // Assert
        expect(decode(bytes)).toBe(text)
        expect(encode(decode(bytes)!)).toEqual(bytes)
      }),
    )
  })

  it('should refuse invalid UTF-8 and text with NUL', () => {
    // Assert
    expect(decode(new Uint8Array([195, 40]) /* C3 28: a lead byte, then no continuation */)).toBeUndefined()
    expect(decode(encode('a\0b'))).toBeUndefined()
  })
})

// Helpers

/** Errors with their edit indices mapped, sorted, so two orders of the same edits compare equal. */
function normalized(errors: PlanError[], index: (i: number) => number): string[] {
  return errors
    .map(e => {
      switch (e.code) {
        case 'OVERLAP':
          return { ...e, edits: e.edits.map(index).sort((a, b) => a - b) }
        default:
          return e.edit === undefined ? e : { ...e, edit: index(e.edit) }
      }
    })
    .map(e => JSON.stringify(e))
    .sort()
}
