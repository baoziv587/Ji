import type { AgentTool, Api, Model, PluginList, RunEvent, Session } from '@gaoxiang.ai/llm'
import type { Attributes, MeterLike, SpanLike } from './index.ts'
import { createAgent, createSession, definePlugin, tool, Type } from '@gaoxiang.ai/llm'
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from '@mariozechner/pi-ai'
import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'
import { otel } from './index.ts'

declare module '@gaoxiang.ai/llm' {
  interface Events {
    'compaction:start': { tokens: number }
    'compaction:end': { before: number; after: number }
  }
}

describe('otel', () => {
  it('should trace a run as invoke_agent with a chat span per model call and an execute_tool span per call', async () => {
    // Arrange
    const tracer = fakeTracer()
    const chat = session([[false]], [otel({ tracer, context: tracer.context })])

    // Act
    await chat.send('go').result

    // Assert
    const [root] = tracer.roots()
    expect(root.name).toBe('invoke_agent')
    expect(tracer.childrenOf(root).map(s => s.name)).toEqual(['chat faux-1', 'execute_tool work', 'chat faux-1'])
    expect(tracer.spans.every(s => s.ended === 1)).toBe(true)
  })

  it('should put the GenAI attributes on the model and tool spans', async () => {
    // Arrange
    const tracer = fakeTracer()
    const chat = session([[false]], [otel({ tracer, context: tracer.context })])

    // Act
    await chat.send('go').result

    // Assert
    const [model, toolSpan] = tracer.spans.slice(1)
    expect(model.attributes).toMatchObject({
      'gen_ai.operation.name': 'chat',
      'gen_ai.request.model': 'faux-1',
      'pi.thinking': 'off',
      'gen_ai.response.finish_reasons': ['toolUse'],
    })
    expect(model.attributes['gen_ai.usage.input_tokens']).toBeTypeOf('number')
    expect(toolSpan.attributes).toMatchObject({
      'gen_ai.operation.name': 'execute_tool',
      'gen_ai.tool.name': 'work',
      'gen_ai.tool.call.id': 'c0.0',
    })
  })

  it('should mark a failed tool call and a failed run as errors', async () => {
    // Arrange
    const tracer = fakeTracer()
    const model = faux([fauxAssistantMessage('x', { stopReason: 'error', errorMessage: 'overloaded' })])
    const failing = session([[true]], [otel({ tracer })])
    const broken = createSession(createAgent({ model, plugins: [otel({ tracer })] }))

    // Act
    await failing.send('go').result
    await broken.send('go').result.catch(() => {})

    // Assert
    const toolSpan = tracer.spans.find(s => s.name === 'execute_tool work')
    const brokenRun = tracer.spans.filter(s => s.name === 'invoke_agent')[1]
    expect(toolSpan).toMatchObject({ status: { code: 2 }, attributes: { 'error.type': 'tool_error' } })
    expect(brokenRun).toMatchObject({ status: { code: 2 }, attributes: { 'error.type': 'provider' } })
  })

  it('should turn a plugin :start / :end pair into a span of its own', async () => {
    // Arrange
    const tracer = fakeTracer()
    const compaction = definePlugin({
      name: 'compaction',
      async *turn(state, next) {
        yield { type: 'compaction:start', tokens: 100 }
        yield { type: 'compaction:end', before: 100, after: 10 }
        return yield* next(state)
      },
    })
    const chat = session([], [compaction, otel({ tracer, context: tracer.context })])

    // Act
    await chat.send('go').result

    // Assert
    const span = tracer.spans.find(s => s.name === 'compaction')
    expect(span).toMatchObject({ ended: 1, attributes: { 'pi.plugin': 'compaction' } })
    expect(span?.parent).toBe(tracer.roots()[0])
  })

  it('should nest a plugin model call under its span and close a failed attempt as an error', async () => {
    // Arrange
    const tracer = fakeTracer()
    const compaction = definePlugin({
      name: 'compaction',
      async *turn(state, next, { complete }) {
        if (state.messages.length === 1) {
          yield { type: 'compaction:start', tokens: 100 }
          yield* complete({ messages: state.messages })
          yield { type: 'compaction:end', before: 100, after: 10 }
        }
        return yield* next(state)
      },
    })
    const fallback = definePlugin({
      name: 'fallback',
      async *request(req, next) {
        try {
          return yield* next(req)
        } catch {
          return yield* next(req)
        }
      },
    })
    const model = faux([
      fauxAssistantMessage('x', { stopReason: 'error', errorMessage: 'overloaded' }),
      fauxAssistantMessage('summary'),
      fauxAssistantMessage('answer'),
    ])
    const plugins = [fallback, compaction, otel({ tracer, context: tracer.context })]

    // Act
    await createSession(createAgent({ model, plugins })).send('go').result

    // Assert
    const span = tracer.spans.find(s => s.name === 'compaction')!
    const [failed, retried] = tracer.childrenOf(span)
    expect(tracer.childrenOf(span).map(s => s.attributes['pi.plugin'])).toEqual(['compaction', 'compaction'])
    expect(failed).toMatchObject({ ended: 1, status: { code: 2 }, attributes: { 'error.type': 'ModelCallError' } })
    expect(retried).toMatchObject({ ended: 1, status: undefined })
    expect(tracer.childrenOf(tracer.roots()[0]).map(s => s.name)).toEqual(['compaction', 'chat faux-1'])
    expect(tracer.spans.every(s => s.ended === 1)).toBe(true)
  })

  it('should record tool updates as span events, at most one per interval', async () => {
    // Arrange
    const tracer = fakeTracer()
    const times = [0, 10, 300]
    const chat = session([[false]], [otel({ tracer, updateInterval: 250, now: () => times.shift()! })], 3)

    // Act
    await chat.send('go').result

    // Assert
    const toolSpan = tracer.spans.find(s => s.name === 'execute_tool work')
    expect(toolSpan?.events.map(e => e.attributes?.['pi.update'])).toEqual(['0', '2'])
  })

  it('should record operation durations and token usage when given a meter', async () => {
    // Arrange
    const meter = fakeMeter()
    const chat = session([[false]], [otel({ tracer: fakeTracer(), meter })])

    // Act
    await chat.send('go').result

    // Assert
    const durations = meter.records('gen_ai.client.operation.duration')
    expect(durations.map(r => r.attributes?.['gen_ai.operation.name'])).toEqual(['chat', 'execute_tool', 'chat'])
    expect(meter.records('gen_ai.client.token.usage').map(r => r.attributes?.['gen_ai.token.type'])).toEqual([
      'input',
      'output',
      'input',
      'output',
    ])
  })

  it('should always end every span exactly once, whatever fails and wherever the run is stopped', async () => {
    const plan = fc.array(fc.array(fc.boolean(), { minLength: 1, size: '-1' }), { size: '-1' })
    const stop = fc.option(fc.record({ at: fc.nat({ max: 40 }), how: fc.constantFrom('interrupt', 'abort') }), {
      nil: undefined,
    })

    await fc.assert(
      fc.asyncProperty(plan, stop, async (p, d) => {
        // Arrange
        const tracer = fakeTracer()
        const chat = session(p, [otel({ tracer, context: tracer.context })])
        const r = chat.send('go')

        // Act
        await readAll(r, n => {
          if (d?.at === n) {
            d.how === 'abort' ? r.abort() : chat.send('stop', { when: 'now' })
          }
        })

        // Assert
        expect(tracer.spans.filter(s => s.ended !== 1)).toEqual([])
        expect(tracer.roots()).toHaveLength(1)
      }),
      { numRuns: 60 },
    )
  })
})

// Helpers

interface FakeSpan extends SpanLike {
  name: string
  attributes: Attributes
  events: Array<{ name: string; attributes?: Attributes }>
  status: { code: number; message?: string } | undefined
  ended: number
  parent: FakeSpan | undefined
}

interface FakeContext {
  span: FakeSpan | undefined
}

function fakeTracer(): {
  spans: FakeSpan[]
  startSpan: (name: string, options?: { attributes?: Attributes }, context?: FakeContext) => FakeSpan
  context: { active: () => FakeContext; setSpan: (context: FakeContext, span: FakeSpan) => FakeContext }
  roots: () => FakeSpan[]
  childrenOf: (span: FakeSpan) => FakeSpan[]
} {
  const spans: FakeSpan[] = []
  return {
    spans,
    startSpan: (name, options, context) => {
      const span: FakeSpan = {
        name,
        attributes: { ...options?.attributes },
        events: [],
        status: undefined,
        ended: 0,
        parent: context?.span,
        setAttributes: attributes => Object.assign(span.attributes, attributes),
        addEvent: (event, attributes) => span.events.push({ name: event, attributes }),
        setStatus: status => (span.status = status),
        end: () => span.ended++,
      }
      spans.push(span)
      return span
    },
    context: { active: () => ({ span: undefined }), setSpan: (_context, span) => ({ span }) },
    roots: () => spans.filter(s => s.parent === undefined),
    childrenOf: span => spans.filter(s => s.parent === span),
  }
}

function fakeMeter(): MeterLike & { records: (name: string) => Array<{ value: number; attributes?: Attributes }> } {
  const all: Array<{ name: string; value: number; attributes?: Attributes }> = []
  return {
    createHistogram: name => ({ record: (value, attributes) => all.push({ name, value, attributes }) }),
    records: name => all.filter(r => r.name === name),
  }
}

const registrations: Array<{ unregister: () => void }> = []
afterEach(() => {
  registrations.splice(0).forEach(r => r.unregister())
})

function faux(responses: Parameters<ReturnType<typeof registerFauxProvider>['setResponses']>[0]): Model<Api> {
  const registration = registerFauxProvider()
  registration.setResponses(responses)
  registrations.push(registration)
  return registration.getModel()
}

/** Each model turn calls `work` once per entry (true: that call fails); spare answers follow an interrupt. */
function session(plan: boolean[][], plugins: PluginList, updates = 1): Session {
  const responses = [
    ...plan.map((calls, i) =>
      fauxAssistantMessage(
        calls.map((fail, j) => fauxToolCall('work', { fail }, { id: `c${i}.${j}` })),
        { stopReason: 'toolUse' },
      ),
    ),
    ...Array.from({ length: 3 }, () => fauxAssistantMessage('done')),
  ]
  return createSession(createAgent({ model: faux(responses), tools: [work(updates)], plugins }))
}

function work(updates: number): AgentTool {
  return tool({
    name: 'work',
    description: 'yields updates, then succeeds or fails',
    parameters: Type.Object({ fail: Type.Boolean() }),
    async *run({ fail }) {
      for (let i = 0; i < updates; i++) {
        yield i
      }
      if (fail) {
        throw new Error('work failed')
      }
      return 'worked'
    },
  })
}

async function readAll(r: AsyncIterable<RunEvent>, onEvent: (n: number) => void): Promise<void> {
  let n = 0
  try {
    for await (const e of r) {
      n++
      if (e.type !== 'run_end') {
        onEvent(n)
      }
    }
  } catch {
    // an aborted run ends by throwing
  }
}
