// before / after / mapDeltas with a hand-written next, no model involved.
import type { Stream } from '@gaoxiang.ai/kernel'
import { describe, expect, it } from 'vitest'
import { after, before, mapDeltas } from './middleware.ts'

/** A stream hook's next: yields `${input}:1`, `${input}:2`, returns `${input}!`; records whether it was closed */
function streamNext(closed: { value: boolean }): (input: string) => Stream<string, string> {
  return input =>
    (async function* () {
      try {
        yield `${input}:1`
        yield `${input}:2`
        return `${input}!`
      } finally {
        closed.value = true
      }
    })()
}

async function drain<D, T>(stream: Stream<D, T>): Promise<{ deltas: D[]; result: T }> {
  const deltas: D[] = []
  for (;;) {
    const r = await stream.next()
    if (r.done) {
      return { deltas, result: r.value }
    }
    deltas.push(r.value)
  }
}

describe('before', () => {
  it('changes the input and passes the output through', async () => {
    const mw = before<number, Promise<number>>(n => n + 1)
    expect(await mw(1, async n => n * 10)).toBe(20)
  })
})

describe('after', () => {
  it('on a promise hook, maps the resolved value and can read the input', async () => {
    const mw = after<number, string>((out, input) => `${out} for ${input}`)
    expect(await mw(3, async n => `got ${n}`)).toBe('got 3 for 3')
  })

  it('on a stream hook, forwards deltas unchanged and maps only the return value', async () => {
    const mw = after<string, string>(out => out.toUpperCase())
    expect(await drain(mw('a', streamNext({ value: false })))).toEqual({ deltas: ['a:1', 'a:2'], result: 'A!' })
  })
})

describe('mapDeltas', () => {
  it('maps every delta and leaves the return value untouched', async () => {
    const mw = mapDeltas<string, string, string>((delta, input) => `${delta}@${input}`)
    expect(await drain(mw('a', streamNext({ value: false })))).toEqual({ deltas: ['a:1@a', 'a:2@a'], result: 'a!' })
  })

  it('passes an early return (cancellation) through to next', async () => {
    const closed = { value: false }
    const stream = mapDeltas<string, string, string>(delta => delta)('a', streamNext(closed))

    await stream.next()
    await stream.return(undefined as never)
    expect(closed.value).toBe(true)
  })
})
