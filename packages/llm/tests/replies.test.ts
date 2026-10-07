// Replies through the LLM layers (RFC-0007 §4, §9): Q1 for the hook helpers, Q6 for tools, and ctx.complete.
import type { FauxResponseStep } from '@earendil-works/pi-ai/compat'
import type { Api, Model, Payload, Plugin, RunEvent, Stream, ToolCall } from '../src/index.ts'
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from '@earendil-works/pi-ai/compat'
import { answerAll, recorder } from '@ji.dev/kernel/testing'
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
    'note:test': { n: number }
  }
}

/** What a request layer can yield: a question, a fact for the run, or content that ctx.complete drops. */
const KINDS = ['ask', 'note', 'text', 'thinking', 'tool_call'] as const

type Kind = (typeof KINDS)[number]

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
    const agent = createAgent({ model, tools: [askingTool], plugins: [answerer(() => 'yes')] })

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
  it('should always hand each reply to the yield that asked, whatever content it drops around it', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.constantFrom(...KINDS), { maxLength: 8 }), async kinds => {
        // Arrange: inside the plugin's own call, a request layer yields questions, facts and content in any order
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
              for (const [i, kind] of kinds.entries()) {
                got.push(yield eventOf(kind, i))
              }
            }
            return yield* next(req)
          },
        })
        const model = fauxModel(['summary', 'answer'])
        const agent = createAgent({ model, plugins: [answerer(question => `re:${question}`), summarizer] })

        // Act
        const events = await collect(createSession(agent).send('go'))

        // Assert: a question gets its own answer; a fact reaches the run, which replies undefined; content is dropped
        expect(got).toEqual(kinds.map((kind, i) => (kind === 'ask' ? `re:q${i}` : undefined)))
        expect(events.flatMap(e => (e.type === 'note:test' ? [e.n] : []))).toEqual(indicesOf(kinds, 'note'))
        expect(events.filter(e => e.type === 'ask:test')).toEqual([])
      }),
      { numRuns: 50 },
    )
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

function eventOf(kind: Kind, i: number): Payload {
  const call: ToolCall = { type: 'toolCall', id: `c${i}`, name: 'x', arguments: {} }
  const events: Record<Kind, Payload> = {
    ask: asking(`q${i}`),
    note: { type: 'note:test', n: i },
    text: { type: 'text', delta: `t${i}` },
    thinking: { type: 'thinking', delta: `h${i}` },
    tool_call: { type: 'tool_call', call },
  }
  return events[kind]
}

function indicesOf<T>(items: readonly T[], item: T): number[] {
  return items.flatMap((x, i) => (x === item ? [i] : []))
}

/** Answers every question, the plugin event or a tool's update, with reply(question) (RFC-0007 §5.2). */
function answerer(reply: (question: string) => unknown): Plugin {
  const answer = (e: Payload): unknown => {
    const question = questionOf(e)
    return question === undefined ? undefined : reply(question)
  }

  return definePlugin({
    name: 'answerer',
    toolCalls: (message, next) => answering(next(message), answer),
    decide: (state, next) => answering(next(state), answer),
  })
}

function questionOf(e: Payload): string | undefined {
  if (e.type === 'ask:test') {
    return e.question
  }
  if (e.type === 'tool_update' && isQuestion(e.data)) {
    return e.data.question
  }
  return undefined
}

function isQuestion(data: unknown): data is { question: string } {
  return typeof data === 'object' && data !== null && 'question' in data && typeof data.question === 'string'
}

/** f gives a value: that is the reply and the event goes no further. f gives undefined: the event goes out as usual. */
async function* answering<T>(inner: Stream<Payload, T>, f: (e: Payload) => unknown): Stream<Payload, T> {
  try {
    let r = await inner.next()
    while (!r.done) {
      const mine = f(r.value)
      r = await inner.next(mine !== undefined ? mine : yield r.value)
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
