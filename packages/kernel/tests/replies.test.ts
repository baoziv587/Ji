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
  it('should not move any source on while the consumer holds a question', async () => {
    // Arrange: a source that would yield forever, and one that asks once
    const progress = { ticks: 0, replies: [] as unknown[] }
    async function* busy(): Stream<string, void> {
      for (;;) {
        yield 'tick'
        progress.ticks++
      }
    }
    async function* asker(): Stream<string, void> {
      progress.replies.push(yield 'ask')
    }
    const merged = merge([busy(), asker()])

    // Act: pull until the question comes out, then hold it
    for (let r = await merged.next(); r.value !== 'ask'; r = await merged.next()) {
      // ticks need no reply
    }
    const held = progress.ticks
    await settle()
    const ticksWhileHeld = progress.ticks - held
    const repliesWhileHeld = progress.replies.length
    await merged.next('yes')

    // Assert
    expect(ticksWhileHeld).toBe(0)
    expect(repliesWhileHeld).toBe(0)
    expect(progress.replies).toEqual(['yes'])
    await merged.return(undefined as never)
  })
})

describe('cancel (Q4)', () => {
  it('should always run the asker finally and nothing after its yield when cancelled while waiting', async () => {
    await fc.assert(
      fc.asyncProperty(fc.nat({ max: 5 }), fc.boolean(), async (before, merged) => {
        // Arrange: `before` plain deltas, then the question
        const life = { closed: 0, answered: 0 }
        async function* asker(): Stream<string, void> {
          try {
            for (let i = 0; i < before; i++) {
              yield 'progress'
            }
            yield 'ask'
            life.answered++
          } finally {
            life.closed++
          }
        }
        const stream = merged ? merge([asker()]) : mapYield(asker(), d => d)

        // Act: pull up to the question, then cancel instead of replying
        for (let r = await stream.next(); !r.done && r.value !== 'ask'; r = await stream.next()) {
          // keep pulling
        }
        await stream.return(undefined as never)

        // Assert
        expect(life).toEqual({ closed: 1, answered: 0 })
      }),
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

/** Lets every pending callback, including timers queued by them, run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}
