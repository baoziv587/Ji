// Replies through the LLM layers (RFC-0007 §4, §9): Q1 for the hook helpers, Q6 for tools, and ctx.complete.
import type { FauxResponseStep } from '@mariozechner/pi-ai'
import type { Api, Model, Payload, Plugin, RunEvent, Stream } from '../src/index.ts'
import { answerAll, recorder } from '@ji.dev/kernel/testing'
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from '@mariozechner/pi-ai'
import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'
import {
  after,
  before,
  createAgent,
  createSession,
  definePlugin,
  intercept,
  mapEvents,
  tool,
  Type,
  user,
} from '../src/index.ts'

declare module '../src/index.ts' {
  interface Events {
    'ask:test': { question: string }
  }
}

/** Yields one question and returns whatever reply it got. */
const askingTool = tool({
  name: 'ask',
  description: 'asks before acting',
  parameters: Type.Object({}),
  async *run() {
    const reply = yield { question: 'go?' }
    return String(reply)
  },
})

describe('hook helpers forward replies (Q1)', () => {
  const helpers = {
    before: before<string, string>(x => x),
    after: after<string, string>(x => x),
    intercept: intercept<string, string>(() => undefined),
    mapEvents: mapEvents<string, string>(e => e),
  }

  it.each(Object.entries(helpers))('%s should always hand replies back to next', async (_, helper) => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.constantFrom<Payload>(asking('a'), asking('b'))), async deltas => {
        // Arrange
        const inner = recorder(deltas, 'end')
        const ctx = { signal: new AbortController().signal }

        // Act
        const { sent } = await answerAll(
          helper('in', () => inner.stream, ctx),
          (_, i) => i,
        )

        // Assert
        expect(inner.got.map(x => x.reply)).toEqual(sent.map(x => x.reply))
      }),
    )
  })
})

describe('a tool yield gets the reply to its tool_update (Q6)', () => {
  it('should reach the tool when a toolCalls layer answers, and not reach the run', async () => {
    // Arrange
    const model = fauxModel([fauxAssistantMessage([fauxToolCall('ask', {})], { stopReason: 'toolUse' }), 'ok'])
    const agent = createAgent({ model, tools: [askingTool], plugins: [answerer('yes')] })

    // Act
    const events = await collect(createSession(agent).send('go'))

    // Assert
    expect(resultTexts(events)).toEqual(['yes'])
    expect(events.filter(e => e.type === 'tool_update')).toEqual([])
  })

  it('should give undefined when no layer answers, as for await does', async () => {
    // Arrange
    const model = fauxModel([fauxAssistantMessage([fauxToolCall('ask', {})], { stopReason: 'toolUse' }), 'ok'])
    const agent = createAgent({ model, tools: [askingTool] })

    // Act
    const events = await collect(createSession(agent).send('go'))

    // Assert
    expect(resultTexts(events)).toEqual(['undefined'])
    expect(events.filter(e => e.type === 'tool_update')).toHaveLength(1)
  })
})

describe('ctx.complete forwards replies (A.2)', () => {
  it('should hand a decide layer reply back to a request layer inside the plugin call', async () => {
    // Arrange: the request layer asks only inside the plugin's own call
    const got: unknown[] = []
    const summarizer = definePlugin({
      name: 'summarizer',
      async *decide(state, next, { complete }) {
        if (state.messages.length === 1) {
          yield* complete({ messages: [user('summarize')] })
        }
        return yield* next(state)
      },
      async *request(req, next, { by }) {
        if (by === 'summarizer') {
          got.push(yield asking('budget?'))
        }
        return yield* next(req)
      },
    })
    const model = fauxModel(['summary', 'answer'])
    const agent = createAgent({ model, plugins: [answerer('more'), summarizer] })

    // Act
    const events = await collect(createSession(agent).send('go'))

    // Assert
    expect(got).toEqual(['more'])
    expect(events.filter(e => e.type === 'ask:test')).toEqual([])
  })
})

// Helpers

const registrations: Array<{ unregister: () => void }> = []
afterEach(() => {
  registrations.splice(0).forEach(r => r.unregister())
})

function asking(question: string): Payload {
  return { type: 'ask:test', question }
}

/** Answers every question, the plugin event or a tool's update, with `reply` (RFC-0007 §5.2). */
function answerer(reply: string): Plugin {
  const isQuestion = (e: Payload): boolean =>
    e.type === 'ask:test' || (e.type === 'tool_update' && typeof e.data === 'object' && e.data !== null)

  return definePlugin({
    name: 'answerer',
    toolCalls: (message, next) => answering(next(message), isQuestion, reply),
    decide: (state, next) => answering(next(state), isQuestion, reply),
  })
}

/** Replies to the events `mine` picks; passes the rest out and their replies back in. */
async function* answering<T>(
  inner: Stream<Payload, T>,
  mine: (e: Payload) => boolean,
  reply: string,
): Stream<Payload, T> {
  try {
    let r = await inner.next()
    while (!r.done) {
      const answer = mine(r.value) ? reply : yield r.value
      r = await inner.next(answer)
    }
    return r.value
  } finally {
    await inner.return(undefined as never)
  }
}

function fauxModel(responses: Array<FauxResponseStep | string>): Model<Api> {
  const registration = registerFauxProvider()
  registration.setResponses(responses.map(r => (typeof r === 'string' ? fauxAssistantMessage(r) : r)))
  registrations.push(registration)
  return registration.getModel()
}

function resultTexts(events: RunEvent[]): string[] {
  return events.flatMap(e =>
    e.type === 'tool_end' ? e.result.content.map(c => (c.type === 'text' ? c.text : '')) : [],
  )
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const all: T[] = []
  for await (const x of source) {
    all.push(x)
  }
  return all
}
