// A reply's run events as they come from the service, for render to read one at a time: they arrive faster than they
// are drawn, so they wait here, in order, until the reply ends.

import type { LiveEvent } from '../../server/events.ts'

export class EventFeed implements AsyncIterable<LiveEvent> {
  private items: LiveEvent[] = []
  /** The next item to read. */
  private head = 0
  private ended = false
  /** Wakes the reader waiting for an item. */
  private wake: (() => void) | undefined
  /** Told once every item pushed so far is read, and the reader is done with it. */
  private readonly drains: (() => void)[] = []

  push(e: LiveEvent): void {
    this.items.push(e)
    this.woken()
  }

  /** No more come: the reader stops once it has read the rest. */
  end(): void {
    this.ended = true
    this.woken()
  }

  /** Resolves once every event pushed so far has been drawn: something asked after them can show after them. */
  drained(): Promise<void> {
    if (this.wake !== undefined || (this.ended && this.head === this.items.length)) {
      return Promise.resolve()
    }
    const { promise, resolve } = Promise.withResolvers<void>()
    this.drains.push(resolve)
    return promise
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<LiveEvent> {
    for (;;) {
      if (this.head < this.items.length) {
        yield this.items[this.head++]
        continue
      }

      this.items = []
      this.head = 0
      this.drains.splice(0).forEach(resolve => resolve())
      if (this.ended) {
        return
      }
      const { promise, resolve } = Promise.withResolvers<void>()
      this.wake = resolve
      await promise
    }
  }

  /** The reader waiting, if any, reads on: until it has, it is not waiting. */
  private woken(): void {
    this.wake?.()
    this.wake = undefined
  }
}
