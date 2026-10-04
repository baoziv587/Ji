// @ji.dev/kernel/testing: checks that a layer forwards replies (RFC-0007 §6.3, I15)
//
//   const inner = recorder(['a', 'b'], 'end')
//   const { sent } = await answerAll(layer(inner.stream), (_, i) => i)
//   expect(inner.got.map(x => x.reply)).toEqual(sent.map(x => x.reply))
//
//   A layer that drops a delta passes no reply for it: that delta's yield gets undefined.

import type { Stream } from './index.ts'

/** One delta and the reply it got. */
export interface Exchange<D> {
  delta: D
  reply: unknown
}

export interface Recorder<D, T> {
  stream: Stream<D, T>
  /** What each yield of `stream` received, in order; fills as the stream is pulled. */
  got: Array<Exchange<D>>
}

/** A stream that yields `deltas` in order, then returns `result`, recording the reply to every yield. */
export function recorder<D, T>(deltas: Iterable<D>, result: T): Recorder<D, T> {
  const got: Array<Exchange<D>> = []

  async function* stream(): Stream<D, T> {
    for (const delta of deltas) {
      const reply = yield delta
      got.push({ delta, reply })
    }
    return result
  }

  return { stream: stream(), got }
}

/** Pulls `stream` to the end, replying to the i-th delta with reply(delta, i). */
export async function answerAll<D, T>(
  stream: Stream<D, T>,
  reply: (delta: D, i: number) => unknown,
): Promise<{ sent: Array<Exchange<D>>; result: T }> {
  const sent: Array<Exchange<D>> = []

  let r = await stream.next()
  while (!r.done) {
    const exchange = { delta: r.value, reply: reply(r.value, sent.length) }
    sent.push(exchange)
    r = await stream.next(exchange.reply)
  }

  return { sent, result: r.value }
}
