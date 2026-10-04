// @ji.dev/plugin-throttle-updates: at most one tool_update per call every `ms` (RFC-0005 §3.5)
//
//   A toolCall middleware is a stream transform, so throttling is a filter over what next yields. Only tool_update
//   events are dropped; tool_start, tool_end, plugin events and the result pass through untouched.

import type { Payload, Plugin, Stream } from '@ji.dev/llm'
import { performance } from 'node:perf_hooks'
import { definePlugin } from '@ji.dev/llm'

export interface ThrottleOptions {
  /** Minimum time between two updates of one call. Default 100. */
  ms?: number
  /** Clock in milliseconds; replace it in tests. */
  now?: () => number
}

export function throttleUpdates({ ms = 100, now = () => performance.now() }: ThrottleOptions = {}): Plugin {
  return definePlugin({
    name: 'throttle-updates',
    toolCall: (call, next) => dropUpdatesWithin(next(call), ms, now),
  })
}

/** One call's stream: an update closer than `ms` to the last one let through is dropped and gets no reply (I15). */
async function* dropUpdatesWithin<T>(events: Stream<Payload, T>, ms: number, now: () => number): Stream<Payload, T> {
  let last: number | undefined
  const keep = (e: Payload): boolean => {
    if (e.type !== 'tool_update') {
      return true
    }

    const time = now()
    if (last !== undefined && time - last < ms) {
      return false
    }
    last = time
    return true
  }

  try {
    let next = await events.next()
    while (!next.done) {
      const e = next.value
      const reply = keep(e) ? yield e : undefined
      next = await events.next(reply)
    }
    return next.value
  } finally {
    // Cancelling the throttled stream cancels the tool behind it
    await events.return(undefined as never)
  }
}
