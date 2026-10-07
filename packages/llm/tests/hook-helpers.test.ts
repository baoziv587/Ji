import type { AssistantMessage, FauxResponseStep, Message, ToolResultMessage } from '@earendil-works/pi-ai/compat'
// before / after / intercept / mapEvents on each of the four streaming hooks, inside a real agent (RFC-0006 §4).
// middleware.test.ts checks the helpers' algebra against a hand-written next; this file checks what each helper
// changes where it sits in the loop: history, the model's input, tools, events and usage. Runs against pi-ai's faux
// provider.
import type { Step } from '@ji.dev/kernel'
import type { AgentAction, AgentState, Api, Model, Plugin, Run, RunEvent } from '../src/index.ts'
import type { Cancellable, Middleware } from '../src/middleware.ts'
import {
  fauxAssistantMessage,
  fauxToolCall,
  registerFauxProvider,
  Type,
  withoutInitialSystemMessage,
} from '@earendil-works/pi-ai/compat'
import { act } from '@ji.dev/kernel'
import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'
import {
  after,
  before,
  callsOf,
  createAgent,
  createSession,
  definePlugin,
  intercept,
  mapEvents,
  textOf,
  tool,
  toolError,
  user,
} from '../src/index.ts'

const echo = tool({
  name: 'echo',
  description: 'upper-case x',
  parameters: Type.Object({ x: Type.String() }),
  run: ({ x }) => x.toUpperCase(),
})

describe('before', () => {
  it('should let decide change what the step sees without writing it to history', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async secret => {
        // Arrange
        const prompt = `my key is ${secret}`
        const seen: Message[][] = []
        const redact = definePlugin({
          name: 'redact',
          decide: before(state => ({
            ...state,
            messages: state.messages.map(m => (m.role === 'user' ? user('[redacted]') : m)),
          })),
        })
        const model = fauxModel([
          ctx => {
            seen.push(withoutInitialSystemMessage(ctx.messages))
            return fauxAssistantMessage('ok')
          },
        ])

        // Act
        const state = await createSession(createAgent({ model, plugins: [redact] })).send(prompt).state

        // Assert
        expect(seen.map(messages => messages.map(shapeOf))).toEqual([[{ role: 'user', text: '[redacted]' }]])
        expect(state.messages.map(shapeOf)[0]).toEqual({ role: 'user', text: prompt })
      }),
    )
  })

  it("should let toolCalls change the calls the tools run while history keeps the model's own", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.string(), { minLength: 1 }), fc.string(), async (args, suffix) => {
        // Arrange
        const append = definePlugin({
          name: 'append',
          toolCalls: before(message => ({
            ...message,
            content: message.content.map(c =>
              c.type === 'toolCall' ? { ...c, arguments: { x: `${c.arguments.x}${suffix}` } } : c,
            ),
          })),
        })
        const model = fauxModel([callEcho(args), fauxAssistantMessage('done')])

        // Act
        const state = await createSession(createAgent({ model, tools: [echo], plugins: [append] })).send('go').state

        // Assert
        expect(resultTexts(state)).toEqual(args.map(x => `${x}${suffix}`.toUpperCase()))
        expect(callArgs(state)).toEqual(args)
      }),
    )
  })

  it('should always leave the run as it was when the callback returns its input, on every streaming hook', async () => {
    await fc.assert(
      fc.asyncProperty(scenario(), streamingHook(), fc.boolean(), async (script, hook, async) => {
        // Arrange
        const plugin = probe(hook, identity('before', async))

        // Act
        const [plain, probed] = [await runScenario(script, []), await runScenario(script, [plugin])]

        // Assert
        expect(probed).toEqual(plain)
      }),
    )
  })
})

describe('after', () => {
  it("should let decide change the step it records while the streamed text stays the model's", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), fc.string(), async (reply, suffix) => {
        // Arrange
        const amend = definePlugin({
          name: 'amend',
          decide: after(step =>
            isModelStep(step) ? act(withText(step.action, `${textOf(step.action)}${suffix}`)) : step,
          ),
        })
        const model = fauxModel([fauxAssistantMessage(reply)])
        const r = createSession(createAgent({ model, plugins: [amend] })).send('go')

        // Act
        const [text, state] = await Promise.all([joined(r.text), r.state])

        // Assert
        expect(text).toBe(reply)
        expect(textOf(state.messages.at(-1) as AssistantMessage)).toBe(`${reply}${suffix}`)
      }),
    )
  })

  it("should let request change the stored message while the streamed text stays the model's", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), fc.string(), async (reply, suffix) => {
        // Arrange
        const amend = definePlugin({
          name: 'amend',
          request: after(message => withText(message, `${textOf(message)}${suffix}`)),
        })
        const model = fauxModel([fauxAssistantMessage(reply)])
        const r = createSession(createAgent({ model, plugins: [amend] })).send('go')

        // Act
        const [text, result] = await Promise.all([joined(r.text), r.result])

        // Assert
        expect(text).toBe(reply)
        expect(textOf(result)).toBe(`${reply}${suffix}`)
      }),
    )
  })

  it("should let toolCalls change the recorded results while tool_end still reports each tool's own", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.string(), { minLength: 1 }), fc.string(), async (args, prefix) => {
        // Arrange
        const tag = definePlugin({
          name: 'tag',
          toolCalls: after(results => results.map(r => withResultText(r, `${prefix}${resultText(r)}`))),
        })
        const model = fauxModel([callEcho(args), fauxAssistantMessage('done')])
        const r = createSession(createAgent({ model, tools: [echo], plugins: [tag] })).send('go')

        // Act
        const [events, state] = await Promise.all([collect(r), r.state])

        // Assert
        const upper = args.map(x => x.toUpperCase())
        expect(resultTexts(state)).toEqual(upper.map(x => `${prefix}${x}`))
        expect(toolEndTexts(events).toSorted()).toEqual(upper.toSorted())
      }),
    )
  })

  it('should let toolCall change the result tool_end reports as well as the recorded one', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.string(), { minLength: 1 }), fc.string(), async (args, prefix) => {
        // Arrange
        const tag = definePlugin({
          name: 'tag',
          toolCall: after(result => withResultText(result, `${prefix}${resultText(result)}`)),
        })
        const model = fauxModel([callEcho(args), fauxAssistantMessage('done')])
        const r = createSession(createAgent({ model, tools: [echo], plugins: [tag] })).send('go')

        // Act
        const [events, state] = await Promise.all([collect(r), r.state])

        // Assert
        const tagged = args.map(x => `${prefix}${x.toUpperCase()}`)
        expect(resultTexts(state)).toEqual(tagged)
        expect(toolEndTexts(events).toSorted()).toEqual(tagged.toSorted())
      }),
    )
  })

  it('should always leave the run as it was when the callback returns its output, on every streaming hook', async () => {
    await fc.assert(
      fc.asyncProperty(scenario(), streamingHook(), fc.boolean(), async (script, hook, async) => {
        // Arrange
        const plugin = probe(hook, identity('after', async))

        // Act
        const [plain, probed] = [await runScenario(script, []), await runScenario(script, [plugin])]

        // Assert
        expect(probed).toEqual(plain)
      }),
    )
  })
})

describe('intercept', () => {
  it('should let request answer without calling the model, so nothing is streamed or counted', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async reply => {
        // Arrange
        let modelCalls = 0
        const cached = definePlugin({
          name: 'cached',
          request: intercept(() => fauxAssistantMessage(reply)),
        })
        const model = fauxModel([
          () => {
            modelCalls++
            return fauxAssistantMessage('from the model')
          },
        ])
        const r = createSession(createAgent({ model, plugins: [cached] })).send('go')

        // Act
        const [events, result, summary] = await Promise.all([collect(r), r.result, r.summary])

        // Assert
        expect(textOf(result)).toBe(reply)
        expect(modelCalls).toBe(0)
        expect(events.filter(e => e.type.startsWith('model_') || e.type === 'text')).toEqual([])
        expect(summary.usage).toMatchObject({ input: 0, output: 0, cost: 0 })
      }),
    )
  })

  it('should let toolCalls refuse the whole batch: no tool runs and no tool events are reported', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.string(), { minLength: 1 }), async args => {
        // Arrange
        const runs = { count: 0 }
        const refuse = definePlugin({
          name: 'refuse',
          toolCalls: intercept(message => callsOf(message).map(call => toolError(call, 'refused'))),
        })
        const model = fauxModel([callEcho(args), fauxAssistantMessage('done')])
        const r = createSession(createAgent({ model, tools: [countingEcho(runs)], plugins: [refuse] })).send('go')

        // Act
        const [events, state] = await Promise.all([collect(r), r.state])

        // Assert
        expect(runs.count).toBe(0)
        // tool_call is the model asking for a call; the tool events are the ones for running it
        expect(
          events.filter(e => e.type === 'tool_start' || e.type === 'tool_update' || e.type === 'tool_end'),
        ).toEqual([])
        expect(resultTexts(state)).toEqual(args.map(() => 'refused'))
      }),
    )
  })

  it('should let toolCall skip each tool while tool_start and tool_end are still reported', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.string(), { minLength: 1 }), async args => {
        // Arrange
        const runs = { count: 0 }
        const refuse = definePlugin({
          name: 'refuse',
          toolCall: intercept(call => toolError(call, 'refused')),
        })
        const model = fauxModel([callEcho(args), fauxAssistantMessage('done')])
        const r = createSession(createAgent({ model, tools: [countingEcho(runs)], plugins: [refuse] })).send('go')

        // Act
        const events = await collect(r)

        // Assert
        expect(runs.count).toBe(0)
        expect(events.filter(e => e.type === 'tool_start')).toHaveLength(args.length)
        expect(toolEndTexts(events)).toEqual(args.map(() => 'refused'))
      }),
    )
  })

  it('should always leave the run as it was when the callback lets the input through, on every streaming hook', async () => {
    await fc.assert(
      fc.asyncProperty(scenario(), streamingHook(), fc.boolean(), async (script, hook, async) => {
        // Arrange
        const plugin = probe(hook, identity('intercept', async))

        // Act
        const [plain, probed] = [await runScenario(script, []), await runScenario(script, [plugin])]

        // Assert
        expect(probed).toEqual(plain)
      }),
    )
  })
})

describe('mapEvents', () => {
  it("should let decide change the model's streamed text, since request runs inside decide, and not the history", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async reply => {
        // Arrange
        const shout = definePlugin({
          name: 'shout',
          decide: mapEvents(e => (e.type === 'text' ? { ...e, delta: e.delta.toUpperCase() } : e)),
        })
        const model = fauxModel([fauxAssistantMessage(reply)])
        const r = createSession(createAgent({ model, plugins: [shout] })).send('go')

        // Act
        const [text, result] = await Promise.all([joined(r.text), r.result])

        // Assert
        expect(text).toBe(reply.toUpperCase())
        expect(textOf(result)).toBe(reply)
      }),
    )
  })

  it('should let toolCalls change what tool_end reports, since the tools run inside it, and not the results', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.string(), { minLength: 1 }), async args => {
        // Arrange
        const hide = definePlugin({
          name: 'hide',
          toolCalls: mapEvents(e =>
            e.type === 'tool_end' ? { ...e, result: withResultText(e.result, '[hidden]') } : e,
          ),
        })
        const model = fauxModel([callEcho(args), fauxAssistantMessage('done')])
        const r = createSession(createAgent({ model, tools: [echo], plugins: [hide] })).send('go')

        // Act
        const [events, state] = await Promise.all([collect(r), r.state])

        // Assert
        expect(toolEndTexts(events)).toEqual(args.map(() => '[hidden]'))
        expect(resultTexts(state)).toEqual(args.map(x => x.toUpperCase()))
      }),
    )
  })

  it('should let toolCall change the updates a tool yields and not its result', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.string()), async updates => {
        // Arrange
        const shout = definePlugin({
          name: 'shout',
          toolCall: mapEvents(e => (e.type === 'tool_update' ? { ...e, data: String(e.data).toUpperCase() } : e)),
        })
        const model = fauxModel([callEcho(['x']), fauxAssistantMessage('done')])
        const r = createSession(createAgent({ model, tools: [reporter(updates)], plugins: [shout] })).send('go')

        // Act
        const [events, state] = await Promise.all([collect(r), r.state])

        // Assert
        expect(events.flatMap(e => (e.type === 'tool_update' ? [e.data] : []))).toEqual(
          updates.map(u => u.toUpperCase()),
        )
        expect(resultTexts(state)).toEqual(['x'])
      }),
    )
  })

  it('should always leave the run as it was when every event maps to itself, on every streaming hook', async () => {
    await fc.assert(
      fc.asyncProperty(scenario(), streamingHook(), async (script, hook) => {
        // Arrange
        const plugin = probe(hook, identity('mapEvents', false))

        // Act
        const [plain, probed] = [await runScenario(script, []), await runScenario(script, [plugin])]

        // Assert
        expect(probed).toEqual(plain)
      }),
    )
  })
})

// Helpers

type StreamingHook = 'decide' | 'request' | 'toolCalls' | 'toolCall'
type Helper = 'before' | 'after' | 'intercept' | 'mapEvents'

/** The model's two replies: a turn calling echo once per argument (none: no tool turn), then a final answer. */
interface Script {
  args: string[]
  reply: string
}

const registrations: Array<{ unregister: () => void }> = []
afterEach(() => {
  registrations.splice(0).forEach(r => r.unregister())
})

function fauxModel(responses: FauxResponseStep[]): Model<Api> {
  const registration = registerFauxProvider()
  registration.setResponses(responses)
  registrations.push(registration)
  return registration.getModel()
}

function countingEcho(runs: { count: number }) {
  return tool({
    ...echo,
    run: ({ x }) => {
      runs.count++
      return x.toUpperCase()
    },
  })
}

/** Named echo too, so callEcho can call it: yields each update, then returns its argument. */
function reporter(updates: string[]) {
  return tool({
    ...echo,
    async *run({ x }) {
      yield* updates
      return x
    },
  })
}

function callEcho(args: string[]): AssistantMessage {
  const calls = args.map((x, i) => fauxToolCall('echo', { x }, { id: `call-${i}` }))
  return fauxAssistantMessage(calls, { stopReason: 'toolUse' })
}

function scenario(): fc.Arbitrary<Script> {
  return fc.record({ args: fc.array(fc.string()), reply: fc.string() })
}

function streamingHook(): fc.Arbitrary<StreamingHook> {
  return fc.constantFrom('decide', 'request', 'toolCalls', 'toolCall')
}

/** A helper whose callback changes nothing, answering right away or after a promise. */
function identity(helper: Helper, async: boolean) {
  const settle = <T>(value: T): T | Promise<T> => (async ? Promise.resolve(value) : value)

  return <I, O, C extends Cancellable>(): Middleware<I, O, C> => {
    switch (helper) {
      case 'before':
        return before<I, O, C>(input => settle(input))
      case 'after':
        return after<I, O, C>(output => settle(output))
      case 'intercept':
        return intercept<I, O, C>(() => settle(undefined))
      case 'mapEvents':
        return mapEvents<I, O, C>(event => event)
    }
  }
}

/** A plugin that puts the helper on one hook. */
function probe(hook: StreamingHook, helper: ReturnType<typeof identity>): Plugin {
  switch (hook) {
    case 'decide':
      return definePlugin({ name: 'probe', decide: helper() })
    case 'request':
      return definePlugin({ name: 'probe', request: helper() })
    case 'toolCalls':
      return definePlugin({ name: 'probe', toolCalls: helper() })
    case 'toolCall':
      return definePlugin({ name: 'probe', toolCall: helper() })
  }
}

/** What a run shows from outside: its events (without timings), the history and the usage. */
async function runScenario({ args, reply }: Script, plugins: Plugin[]) {
  const script = args.length > 0 ? [callEcho(args), fauxAssistantMessage(reply)] : [fauxAssistantMessage(reply)]
  const r = createSession(createAgent({ model: fauxModel(script), tools: [echo], plugins })).send('go')
  const [events, state, summary] = await Promise.all([collect(r), r.state, r.summary])

  return {
    // The faux model cuts a call's arguments at random
    events: events.filter(e => e.type !== 'tool_call_delta').map(e => (e.type === 'text' ? `text ${e.delta}` : e.type)),
    history: state.messages.map(shapeOf),
    usage: summary.usage,
  }
}

async function collect(r: Run): Promise<RunEvent[]> {
  const all: RunEvent[] = []
  for await (const e of r) {
    all.push(e)
  }
  return all
}

async function joined(text: AsyncIterable<string>): Promise<string> {
  let all = ''
  for await (const delta of text) {
    all += delta
  }
  return all
}

/** A message without its timestamp and ids, which differ from run to run. */
function shapeOf(m: Message) {
  switch (m.role) {
    case 'user':
      return { role: m.role, text: typeof m.content === 'string' ? m.content : textParts(m.content) }
    case 'assistant':
      return { role: m.role, text: textOf(m), calls: callsOf(m).map(c => [c.name, c.arguments]) }
    case 'toolResult':
      return { role: m.role, name: m.toolName, text: resultText(m), isError: m.isError }
  }
}

function textParts(content: Array<{ type: string; text?: string }>): string {
  return content.flatMap(c => (c.type === 'text' && c.text !== undefined ? [c.text] : [])).join('')
}

function resultText(result: ToolResultMessage): string {
  return textParts(result.content)
}

function withResultText(result: ToolResultMessage, text: string): ToolResultMessage {
  return { ...result, content: [{ type: 'text', text }] }
}

function withText(message: AssistantMessage, text: string): AssistantMessage {
  return { ...message, content: [{ type: 'text', text }] }
}

function resultTexts(state: AgentState): string[] {
  return state.messages.flatMap(m => (m.role === 'toolResult' ? [resultText(m)] : []))
}

function callArgs(state: AgentState): string[] {
  return state.messages.flatMap(m => (m.role === 'assistant' ? callsOf(m).map(c => String(c.arguments.x)) : []))
}

function toolEndTexts(events: RunEvent[]): string[] {
  return events.flatMap(e => (e.type === 'tool_end' ? [resultText(e.result)] : []))
}

function isModelStep(step: Step<AgentAction, AssistantMessage>): step is { tag: 'act'; action: AssistantMessage } {
  return step.tag === 'act' && 'role' in step.action
}
