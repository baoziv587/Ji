// Replies travel back the way their delta came out (RFC-0007 §9, I15): Q1 forwarding, Q2 routing, Q3 pause, Q4 cancel.
import type { Agent, Stream } from '../src/index.ts'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { act, done, mapYield, merge, unfold } from '../src/index.ts'
import { answerAll, recorder } from '../src/testing.ts'

describe('forwarding (Q1)', () => {
  it('should always hand mapYield replies back to the inner yields, in order', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.integer()), fc.array(fc.anything()), async (deltas, replies) => {
        // Arrange
        const inner = recorder(deltas, 'end')

        // Act
        const { sent, result } = await answerAll(
          mapYield(inner.stream, d => d * 2),
          (_, i) => replies[i],
        )

        // Assert
        expect(result).toBe('end')
        expect(sent.map(x => x.delta)).toEqual(deltas.map(d => d * 2))
        expect(inner.got).toEqual(deltas.map((delta, i) => ({ delta, reply: replies[i] })))
      }),
    )
  })

  it('should always hand yield* replies back to the inner yields, in order', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.string()), fc.array(fc.anything()), async (deltas, replies) => {
        // Arrange
        const inner = recorder(deltas, 'end')
        async function* delegate(): Stream<string, string> {
          return yield* inner.stream
        }

        // Act
        const { sent } = await answerAll(delegate(), (_, i) => replies[i])

        // Assert
        expect(inner.got.map(x => x.reply)).toEqual(sent.map(x => x.reply))
      }),
    )
  })

  it('should hand unfold delta replies back to the policy and env yields that made them', async () => {
    // Arrange: one act step, then done; every yield records its reply
    const got: Array<[string, unknown]> = []
    const agent: Agent<number, number, number, string, string> = {
      async *policy(s) {
        got.push(['policy', yield `p${s}`])
        return s > 0 ? done('ok') : act(1)
      },
      async *env(a) {
        got.push(['env', yield `e${a}`])
        return a
      },
      update: (s, _a, o) => s + o,
    }

    // Act
    await answerAll(unfold(agent, 0), e => (e.tag === 'delta' ? `re:${e.delta}` : `ignored:${e.tag}`))

    // Assert
    expect(got).toEqual([
      ['policy', 're:p0'],
      ['env', 're:e1'],
      ['policy', 're:p1'],
    ])
  })
})

describe('routing (Q2)', () => {
  it('should always deliver the reply to a delta to its own source, exactly once, whatever the timing', async () => {
    await fc.assert(
      fc.asyncProperty(fc.scheduler(), fc.array(fc.array(fc.nat())), async (s, plans) => {
        // Arrange: the consumer replies to each delta with a token naming it
        const got = plans.map((): unknown[] => [])
        const sources = plans.map((plan, source) => askingSource(s, source, plan, got[source]))

        // Act
        await s.waitFor(answerAll(merge(sources), d => replyTo(d)))

        // Assert
        plans.forEach((plan, source) => {
          expect(got[source]).toEqual(plan.map((value, k) => replyTo({ source, k, value })))
        })
      }),
    )
  })
})

describe('pause (Q3)', () => {
  it('should always keep every source where it is while the consumer holds a question, whatever the timing', async () => {
    await fc.assert(
      fc.asyncProperty(fc.scheduler(), fc.nat({ max: 3 }), fc.array(fc.array(fc.nat())), async (s, before, plans) => {
        // Arrange: an asker after `before` plain deltas, beside sources that keep yielding
        const life = newLife()
        const replies: unknown[] = []
        const merged = merge([asker(s, before, life, replies), ...plans.map(plan => source(s, plan, life))])

        // Act: pull up to the question, hold it while everything scheduled runs, then reply
        await s.waitFor(pullUntilQuestion(merged))
        const resumedBefore = life.resumed
        await s.waitAll()
        const held = { resumed: life.resumed - resumedBefore, replies: replies.length }
        await s.waitFor(merged.next('yes'))
        await s.waitFor(merged.return(undefined as never))

        // Assert: a running source may reach its next yield, but none gets past one
        expect(held).toEqual({ resumed: 0, replies: 0 })
        expect(replies).toEqual(['yes'])
      }),
    )
  })
})

describe('cancel (Q4)', () => {
  it('should always run the asker finally and nothing after its yield when mapYield is cancelled there', async () => {
    await fc.assert(
      fc.asyncProperty(fc.scheduler(), fc.nat({ max: 5 }), async (s, before) => {
        // Arrange
        const life = newLife()
        const replies: unknown[] = []
        const mapped = mapYield(asker(s, before, life, replies), d => d)

        // Act: pull up to the question, then cancel instead of replying
        await s.waitFor(pullUntilQuestion(mapped))
        await s.waitFor(mapped.return(undefined as never))

        // Assert
        expect(replies).toEqual([])
        expect(life).toMatchObject({ started: 1, closed: 1 })
      }),
    )
  })

  it('should always close every source, and run nothing after the asker yield, when merge is cancelled while others still run', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.scheduler(),
        fc.nat({ max: 3 }),
        fc.array(fc.array(fc.nat()), { minLength: 1 }),
        async (s, before, plans) => {
          // Arrange: the asker beside sources that are still working when the question comes out
          const askerLife = newLife()
          const othersLife = newLife()
          const replies: unknown[] = []
          const merged = merge([
            asker(s, before, askerLife, replies),
            ...plans.map(plan => source(s, plan, othersLife)),
          ])

          // Act: pull up to the question, then cancel instead of replying
          await s.waitFor(pullUntilQuestion(merged))
          await s.waitFor(merged.return(undefined as never))

          // Assert: a source that never started holds nothing; every started one has run its finally
          expect(replies).toEqual([])
          expect(askerLife).toMatchObject({ started: 1, closed: 1 })
          expect(othersLife.closed).toBe(othersLife.started)
        },
      ),
    )
  })
})

// Helpers

interface Tagged {
  source: number
  k: number
  value: number
}

function replyTo({ source, k }: Tagged): string {
  return `reply ${source}.${k}`
}

/** Yields its plan after scheduled waits, tagging every delta, and records each reply it gets. */
async function* askingSource(s: fc.Scheduler, source: number, plan: number[], got: unknown[]): Stream<Tagged, number> {
  for (const [k, value] of plan.entries()) {
    await s.schedule(Promise.resolve())
    got.push(yield { source, k, value })
  }
  return source
}

const QUESTION = 'question'

type Delta = number | typeof QUESTION

/** How many generators started, ran their finally, and went on past a yield. */
interface Life {
  started: number
  closed: number
  resumed: number
}

function newLife(): Life {
  return { started: 0, closed: 0, resumed: 0 }
}

/** Yields `before` plain deltas, then the question; records the reply it gets. Every step waits on the scheduler. */
async function* asker(s: fc.Scheduler, before: number, life: Life, replies: unknown[]): Stream<Delta, void> {
  life.started++
  try {
    for (let i = 0; i < before; i++) {
      await s.schedule(Promise.resolve())
      yield i
      life.resumed++
    }

    await s.schedule(Promise.resolve())
    replies.push(yield QUESTION)
    life.resumed++
  } finally {
    life.closed++
  }
}

/** Yields its plan, every step waiting on the scheduler. */
async function* source(s: fc.Scheduler, plan: number[], life: Life): Stream<Delta, void> {
  life.started++
  try {
    for (const value of plan) {
      await s.schedule(Promise.resolve())
      yield value
      life.resumed++
    }
  } finally {
    life.closed++
  }
}

/** Pulls without replying until the question comes out, and leaves it unanswered. */
async function pullUntilQuestion(stream: Stream<Delta, unknown>): Promise<void> {
  for (let r = await stream.next(); !r.done && r.value !== QUESTION; r = await stream.next()) {
    // plain deltas need no reply
  }
}
