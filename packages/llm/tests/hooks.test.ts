// Plugin hooks as RFC-0006 defines them: the list order, registration, ctx, ctx.complete, model attempts, observer
// misuse, development checks and the error channels. Runs against pi-ai's faux provider.
import type { FakeReply, FakeRequest } from '@ji.dev/testing'
import type {
  AgentState,
  Api,
  AssistantMessage,
  Message,
  Model,
  Plugin,
  RunEvent,
  Session,
  UsageTotals,
} from '../src/index.ts'
import process from 'node:process'
import { assistantMessage, createFakeModel, toolUse } from '@ji.dev/testing'
import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  before,
  createAgent,
  createSession,
  definePlugin,
  intercept,
  PluginConflictError,
  RunError,
  stop,
  textOf,
  tool,
  toolError,
  Type,
  usageOf,
  user,
} from '../src/index.ts'

const echo = tool({
  name: 'echo',
  description: 'upper-case x',
  parameters: Type.Object({ x: Type.String() }),
  run: ({ x }) => x.toUpperCase(),
})

const callEcho = (x: string): AssistantMessage => assistantMessage([toolUse('echo', { x })])

const failed = (): AssistantMessage => assistantMessage('x', { stopReason: 'error', errorMessage: 'overloaded' })

/** One call's attempts, true for a failure: some failures, then the success the retry is waiting for. */
const attempts: fc.Arbitrary<boolean[]> = fc
  .nat({ max: 3 })
  .map(failures => [...Array.from<boolean>({ length: failures }).fill(true), false])

beforeEach(() => {
  // Warnings are asserted through this spy; keep them out of the test output
  vi.spyOn(process, 'emitWarning').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('plugin order (§6)', () => {
  it('should always enter middleware in list order, leave in reverse, and run transforms and observers in order', async () => {
    await fc.assert(
      fc.asyncProperty(fc.shuffledSubarray(['a', 'b', 'c'], { minLength: 1 }), async names => {
        // Arrange
        const log: string[] = []
        const plugins = names.map(name => traced(name, log))
        const model = fauxModel([callEcho('x'), assistantMessage('ok')])
        const agent = createAgent({ model, tools: [echo], plugins, checkDeterminism: false })

        // Act
        await createSession(agent).send('go').result

        // Assert
        const reversed = names.toReversed()
        for (const hook of ['decide', 'request', 'toolCalls', 'toolCall', 'record']) {
          expectRepeats(pick(log, `${hook}>`, `${hook}<`), [
            ...names.map(n => `${hook}> ${n}`),
            ...reversed.map(n => `${hook}< ${n}`),
          ])
        }
        expectRepeats(
          pick(log, 'reduce'),
          reversed.map(n => `reduce ${n}`),
        )
        expectRepeats(
          pick(log, 'input'),
          names.map(n => `input ${n}`),
        )
        expectRepeats(
          pick(log, 'observe'),
          names.map(n => `observe ${n}`),
        )
      }),
      { numRuns: 20 },
    )
  })

  it('should let the first plugin change a request before the second one sees it', async () => {
    // Arrange
    const seen: string[] = []
    const first = definePlugin({ name: 'first', request: before(req => ({ ...req, systemPrompt: 'A' })) })
    const second = definePlugin({
      name: 'second',
      request: before(req => {
        seen.push(req.systemPrompt)
        return { ...req, systemPrompt: `${req.systemPrompt}B` }
      }),
    })
    const model = fauxModel([ctx => assistantMessage(`prompt=${ctx.system}`)])

    // Act
    const result = await createSession(createAgent({ model, plugins: [first, second] })).send('go').result

    // Assert
    expect(seen).toEqual(['A'])
    expect(textOf(result)).toBe('prompt=AB')
  })
})

describe('registration (§6.1)', () => {
  it('should register a plugin that appears twice only once, keeping its first place', async () => {
    // Arrange
    const events: string[] = []
    const counter = definePlugin({
      name: 'counter',
      tools: [echo],
      system: s => `${s}+C`,
      state: { init: 0, reduce: n => n + 1 },
      observe: e => events.push(e.type),
    })
    const other = definePlugin({ name: 'other', system: s => `${s}+O` })
    let prompt: string | undefined
    const model = fauxModel([
      ctx => {
        prompt = ctx.system
        return assistantMessage('ok')
      },
    ])

    // Act
    const r = createSession(createAgent({ model, system: 'S', plugins: [counter, [other, counter]] })).send('go')
    const state = await r.state

    // Assert
    expect(prompt).toBe('S+C+O')
    expect(counter.select(state)).toBe(2)
    expect(events.filter(type => type === 'run_end')).toHaveLength(1)
  })

  it('should dedupe the same way through agent.with', async () => {
    // Arrange
    const counter = definePlugin({ name: 'counter', state: { init: 0, reduce: n => n + 1 } })
    const agent = createAgent({ model: fauxModel([assistantMessage('ok')]) })

    // Act
    const state = await createSession(agent.with({ plugins: [[counter], counter] })).send('go').state

    // Assert
    expect(counter.select(state)).toBe(2)
  })

  it('should reject two different plugin objects sharing a name', () => {
    // Arrange
    const model = fauxModel([])
    const counter = definePlugin({ name: 'counter' })
    const another = definePlugin({ name: 'counter' })

    // Act
    const create = (): unknown => createAgent({ model, plugins: [counter, [another]] })

    // Assert
    expect(create).toThrow(PluginConflictError)
  })
})

describe('ctx (§3)', () => {
  it('should give every hook of a step the committed snapshot and its own state read from it', async () => {
    // Arrange
    const seen: Array<{ hook: string; state: AgentState; own: unknown }> = []
    const chat: { session?: Session } = {}
    const watch = (hook: string, ctx: { state: AgentState; own: number }): void => {
      seen.push({ hook, state: ctx.state, own: ctx.own })
    }
    const watcher = definePlugin({
      name: 'watcher',
      state: { init: 0, reduce: n => n + 1 },
      async *decide(state, next, ctx) {
        watch('decide', ctx)
        seen.push({ hook: 'committed', state: chat.session!.state, own: watcher.select(state) })
        return yield* next(state)
      },
      input: (messages, ctx) => {
        watch('input', ctx)
        return messages
      },
      request: (req, next, ctx) => {
        watch('request', ctx)
        return next(req)
      },
      toolCalls: (message, next, ctx) => {
        watch('toolCalls', ctx)
        return next(message)
      },
      toolCall: (call, next, ctx) => {
        watch('toolCall', ctx)
        return next(call)
      },
    })
    chat.session = createSession(
      createAgent({ model: fauxModel([callEcho('a'), assistantMessage('ok')]), tools: [echo], plugins: [watcher] }),
    )

    // Act
    await chat.session.send('go').result

    // Assert
    expect(seen.every(s => s.own === watcher.select(s.state))).toBe(true)
    // input, the tool call, the answer, and the idle step that stops
    const steps = splitAt(seen, s => s.hook === 'decide')
    expect(steps).toHaveLength(4)
    for (const step of steps) {
      expect(new Set(step.map(s => s.state)).size).toBe(1)
    }
    expect(new Set(seen.map(s => s.hook))).toEqual(
      new Set(['decide', 'committed', 'input', 'request', 'toolCalls', 'toolCall']),
    )
  })

  it('should fire ctx.signal for IO a hook started when the run is aborted', async () => {
    // Arrange
    const started = Promise.withResolvers<AbortSignal>()
    const slow = definePlugin({
      name: 'slow',
      input: (_messages, { signal }) => {
        started.resolve(signal)
        return new Promise<Message[]>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason))
        })
      },
    })
    const r = createSession(createAgent({ model: fauxModel([]), plugins: [slow] })).send('go')

    // Act
    const signal = await started.promise
    r.abort()

    // Assert
    await expect(r.result).rejects.toMatchObject({ kind: 'aborted' })
    expect(signal.aborted).toBe(true)
  })

  it('should infer own from state.init wherever state is declared, and keep helpers off record', () => {
    const early = definePlugin({
      name: 'early',
      state: { init: { n: 0 }, reduce: own => own },
      input: (messages, { own }) => {
        expectTypeOf(own).toEqualTypeOf<{ n: number }>()
        return messages
      },
    })
    const late = definePlugin({
      name: 'late',
      decide: intercept((state, { own }) => {
        expectTypeOf(own).toEqualTypeOf<number>()
        return own > 3 ? stop(state) : undefined
      }),
      state: { init: 0, reduce: n => n + 1 },
    })
    const stateless = definePlugin({
      name: 'stateless',
      request: (req, next, ctx) => {
        expectTypeOf(ctx.own).toEqualTypeOf<undefined>()
        // @ts-expect-error a request hook has no complete: it would go through itself again
        void ctx.complete
        return next(req)
      },
    })
    // Without `state`, a helper's callback still gets the hook's own ctx, not just the helpers' bare { signal }
    definePlugin({
      name: 'stateless-helpers',
      request: before((req, { by, own }) => {
        expectTypeOf(by).toEqualTypeOf<string | undefined>()
        expectTypeOf(own).toEqualTypeOf<undefined>()
        return req
      }),
      decide: intercept((_state, { complete }) => {
        expectTypeOf(complete).toBeFunction()
        return undefined
      }),
    })
    definePlugin({
      name: 'pure-record',
      // @ts-expect-error record is pure and synchronous, so the stream helpers do not fit it
      record: before(input => input),
    })

    expectTypeOf(early.select).returns.toEqualTypeOf<{ n: number }>()
    expectTypeOf(late.select).returns.toEqualTypeOf<number>()
    expectTypeOf(stateless.select).returns.toEqualTypeOf<undefined>()
  })
})

describe('ctx.complete (§5)', () => {
  it('should call the model through the request chain with its own defaults, and stream none of its content', async () => {
    // Arrange
    const requests: Array<{ by?: string; system?: string; tools: number }> = []
    const bys: Array<string | undefined> = []
    let summary: AssistantMessage | undefined
    const summarizer = definePlugin({
      name: 'summarizer',
      async *decide(state, next, { complete }) {
        if (state.messages.length === 1) {
          summary = yield* complete({ messages: [user('summarize')] })
        }
        return yield* next(state)
      },
      request: (req, next, { by }) => {
        bys.push(by)
        return next(req)
      },
    })
    const model = fauxModel([seeRequest(requests, 'aux secret'), seeRequest(requests, 'answer')])
    const r = createSession(createAgent({ model, system: 'S', tools: [echo], plugins: [summarizer] })).send('go')
    const text = collect(r.text)

    // Act
    const events = await collect(r)

    // Assert
    expect(textOf(summary!)).toBe('aux secret')
    expect((await text).join('')).toBe('answer')
    expect(bys).toEqual(['summarizer', undefined])
    expect(requests).toEqual([
      { system: '', tools: 0 },
      { system: 'S', tools: 1 },
    ])
    expect(modelEvents(events)).toEqual([
      'model_start by summarizer',
      'model_end by summarizer',
      'model_start',
      'model_end',
    ])
  })

  it('should count its usage in r.summary but not in usageOf the history', async () => {
    // Arrange
    const summarizer = definePlugin({
      name: 'summarizer',
      async *decide(state, next, { complete }) {
        if (state.messages.length === 1) {
          yield* complete({ messages: [user('a long enough prompt to be billed for')] })
        }
        return yield* next(state)
      },
    })
    const model = fauxModel([assistantMessage('summary'), assistantMessage('answer')])
    const r = createSession(createAgent({ model, plugins: [summarizer] })).send('go')

    // Act
    const events = await collect(r)
    const summary = await r.summary

    // Assert
    expect(summary.usage).toEqual(billed(events))
    expect(summary.usage.input).toBeGreaterThan(usageOf(await r.state).input)
  })

  it('should let fallback in the request chain retry it, closing the failed attempt with model_error', async () => {
    // Arrange
    const summarizer = definePlugin({
      name: 'summarizer',
      async *decide(state, next, { complete }) {
        if (state.messages.length === 1) {
          yield* complete({ messages: [user('summarize')] })
        }
        return yield* next(state)
      },
    })
    const model = fauxModel([failed(), assistantMessage('summary'), assistantMessage('answer')])
    const agent = createAgent({ model, plugins: [retryModel(2), summarizer] })

    // Act
    const events = await collect(createSession(agent).send('go'))

    // Assert
    expect(modelEvents(events)).toEqual([
      'model_start by summarizer',
      'model_error by summarizer',
      'model_start by summarizer',
      'model_end by summarizer',
      'model_start',
      'model_end',
    ])
    expectAttemptsClosed(events)
  })

  it('should let its own signal cut the call short without cancelling the step', async () => {
    // Arrange
    const provider = gate()
    const local = new AbortController()
    let stepAborted: boolean | undefined
    const summarizer = definePlugin({
      name: 'summarizer',
      async *decide(state, next, { complete, signal }) {
        if (state.messages.length === 1) {
          try {
            yield* complete({ messages: [user('summarize')] }, { signal: local.signal })
          } catch {
            stepAborted = signal.aborted
          }
        }
        return yield* next(state)
      },
    })
    const model = fauxModel([blockedUntil(provider, 'summary'), assistantMessage('answer')])
    const r = createSession(createAgent({ model, plugins: [summarizer] })).send('go')
    const events = collect(r)

    // Act
    await provider.started
    local.abort()
    provider.open()

    // Assert
    expect(textOf(await r.result)).toBe('answer')
    expect(stepAborted).toBe(false)
    expect(modelEvents(await events)).toEqual([
      'model_start by summarizer',
      'model_error by summarizer',
      'model_start',
      'model_end',
    ])
  })

  it('should close an attempt cut off by aborting the run with step_cancelled, and abort its request', async () => {
    // Arrange
    const provider = gate()
    const summarizer = definePlugin({
      name: 'summarizer',
      async *decide(state, next, { complete }) {
        yield* complete({ messages: [user('summarize')] }, { signal: new AbortController().signal })
        return yield* next(state)
      },
    })
    let seen: AbortSignal | undefined
    const model = fauxModel([
      async request => {
        seen = request.signal
        await provider.wait()
        return assistantMessage('summary')
      },
    ])
    const r = createSession(createAgent({ model, plugins: [summarizer] })).send('go')
    const events = read(r)

    // Act
    await provider.started
    r.abort()
    provider.open()

    // Assert
    await expect(r.result).rejects.toMatchObject({ kind: 'aborted' })
    expect(seen?.aborted).toBe(true)
    expect((await events).map(e => e.type).slice(-3)).toEqual(['model_start', 'step_cancelled', 'run_end'])
  })

  it('should keep the usage of a finished call when its step ends by stop or by throwing', async () => {
    for (const ending of ['stop', 'throw'] as const) {
      // Arrange
      const summarizer = definePlugin({
        name: 'summarizer',
        async *decide(state, next, { complete }) {
          if (state.messages.length < 3) {
            return yield* next(state)
          }

          yield* complete({ messages: [user('summarize everything said so far')] })
          if (ending === 'throw') {
            throw new Error('after the summary')
          }
          return stop(state)
        },
      })
      const model = fauxModel([assistantMessage('summary')])
      const history = [user('q'), assistantMessage('a')]
      const r = createSession(createAgent({ model, plugins: [summarizer] }), { state: history }).send('go')

      // Act
      const end = (await read(r)).at(-1)

      // Assert
      const summary = end?.type === 'run_end' ? end.summary : undefined
      expect(summary?.turns).toBe(0)
      expect(summary?.usage.input).toBeGreaterThan(0)
    }
  })
})

describe('model attempts (§5.4–§5.5, appendix A.6–A.7)', () => {
  it('should always close each attempt once, keep at most one open, and bill exactly the closed ones', async () => {
    await fc.assert(
      fc.asyncProperty(attempts, attempts, async (aux, main) => {
        // Arrange
        const helper = definePlugin({
          name: 'helper',
          async *decide(state, next, { complete }) {
            if (state.messages.length === 1) {
              yield* complete({ messages: [user('help')] })
            }
            return yield* next(state)
          },
        })
        const script = [...aux, ...main].map(fail => (fail ? failed() : assistantMessage('ok')))
        const agent = createAgent({ model: fauxModel(script), plugins: [retryModel(Infinity), helper] })

        // Act
        const events = await collect(createSession(agent).send('go'))

        // Assert
        expectAttemptsClosed(events)
        const starts = events.flatMap(e => (e.type === 'model_start' ? [e.by] : []))
        expect(starts).toEqual([...aux.map(() => 'helper'), ...main.map(() => undefined)])
        const end = events.at(-1)
        expect(end?.type === 'run_end' && end.summary.usage).toEqual(billed(events))
      }),
      { numRuns: 30 },
    )
  })
})

describe('observe misuse (§4.3)', () => {
  it('should report an observer that returns a promise, catch its rejections, and keep the others going', async () => {
    // Arrange
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    const seen: string[] = []
    const plugins = [
      definePlugin({
        name: 'async-log',
        observe: async () => {
          throw new Error('export failed')
        },
      }),
      definePlugin({
        name: 'thenable',
        observe: () => ({ then: (_: unknown, reject: (e: unknown) => void) => reject(new Error('odd')) }) as never,
      }),
      definePlugin({ name: 'log', observe: e => seen.push(e.type) }),
    ]

    // Act
    const events = await collect(
      createSession(createAgent({ model: fauxModel([assistantMessage('ok')]), plugins })).send('go'),
    )
    await new Promise(resolve => setTimeout(resolve, 0))
    process.off('unhandledRejection', unhandled)

    // Assert
    const warnings = vi.mocked(process.emitWarning).mock.calls.map(([message]) => String(message))
    expect(seen).toEqual(events.map(e => e.type))
    expect(unhandled).not.toHaveBeenCalled()
    expect(warnings.filter(w => w.includes('returned a promise'))).toHaveLength(2)
    expect(warnings.filter(w => w.includes('"async-log" rejected'))).toHaveLength(events.length)
    expect(warnings.some(w => w.includes('"thenable" rejected'))).toBe(true)
  })
})

describe('development checks (§8)', () => {
  it('should warn once about a reducer whose two runs disagree, and commit the first result', async () => {
    // Arrange
    let sequence = 0
    const unstable = definePlugin({ name: 'unstable', state: { init: 0, reduce: () => ++sequence } })
    const model = fauxModel([callEcho('a'), assistantMessage('ok')])

    // Act
    const agent = createAgent({ model, tools: [echo], plugins: [unstable], checkDeterminism: true })
    const state = await createSession(agent).send('go').state

    // Assert
    expect(unstable.select(state)).toBe(5)
    expect(warningsOf('DeterminismWarning')).toHaveLength(1)
  })

  it('should neither warn about nor double a pure reducer', async () => {
    // Arrange
    const counter = definePlugin({ name: 'counter', state: { init: 0, reduce: (n: number) => n + 1 } })
    const model = fauxModel([callEcho('a'), assistantMessage('ok')])

    // Act
    const agent = createAgent({ model, tools: [echo], plugins: [counter], checkDeterminism: true })
    const state = await createSession(agent).send('go').state

    // Assert
    expect(counter.select(state)).toBe(3)
    expect(warningsOf('DeterminismWarning')).toHaveLength(0)
  })

  it('should throw where a hook writes to committed state, and let it pass with the checks off', async () => {
    for (const checkDeterminism of [true, false]) {
      // Arrange
      const counter = definePlugin({
        name: 'counter',
        state: { init: { model: 0 }, reduce: own => ({ model: own.model + 1 }) },
        input: (messages, ctx) => {
          ctx.own.model++
          return messages
        },
      })
      const model = fauxModel([assistantMessage('ok')])
      const agent = createAgent({ model, plugins: [counter], checkDeterminism })

      // Act
      const outcome = await createSession(agent)
        .send('go')
        .result.then(
          () => undefined,
          (error: unknown) => error,
        )

      // Assert
      if (checkDeterminism) {
        expect(outcome).toBeInstanceOf(RunError)
        expect((outcome as RunError).cause).toBeInstanceOf(TypeError)
      } else {
        expect(outcome).toBeUndefined()
      }
    }
  })

  it('should freeze the state a session starts from, at its first run', async () => {
    // Arrange
    const history: Message[] = [user('earlier'), assistantMessage('reply')]
    const model = fauxModel([assistantMessage('ok')])
    const chat = createSession(createAgent({ model, checkDeterminism: true }), { state: history })

    // Act
    await chat.send('go').result

    // Assert
    expect(Object.isFrozen(history)).toBe(true)
    expect(() => (chat.state.messages as Message[]).push(user('sneaky'))).toThrow(TypeError)
  })
})

describe('errors and retries (§4.2)', () => {
  it('should retry a thrown failure but never a toolError result', async () => {
    // Arrange
    const calls = { flaky: 0, refusing: 0 }
    const flaky = tool({
      name: 'flaky',
      description: 'fails twice, then works',
      parameters: Type.Object({}),
      run: () => {
        if (++calls.flaky < 3) {
          throw new Error('transient')
        }
        return 'worked'
      },
    })
    const refusing = definePlugin({
      name: 'refusing',
      toolCall: intercept(call => {
        if (call.name !== 'refused') {
          return undefined
        }
        calls.refusing++
        return toolError(call, 'not allowed')
      }),
    })
    const refused = tool({ ...flaky, name: 'refused', run: () => 'never' })
    const model = fauxModel([assistantMessage([toolUse('flaky', {}), toolUse('refused', {})]), assistantMessage('ok')])
    const agent = createAgent({ model, tools: [flaky, refused], plugins: [retryTool(3), refusing] })

    // Act
    const state = await createSession(agent).send('go').state

    // Assert
    const results = state.messages.filter(m => m.role === 'toolResult')
    expect(calls).toEqual({ flaky: 3, refusing: 1 })
    expect(results.map(m => m.isError)).toEqual([false, true])
  })

  it('should not retry once the run is aborted', async () => {
    // Arrange
    let attempts = 0
    const started = Promise.withResolvers<void>()
    const hang = tool({
      name: 'hang',
      description: 'fails when aborted',
      parameters: Type.Object({}),
      run: (_args, signal) => {
        attempts++
        started.resolve()
        return new Promise<string>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')))
        })
      },
    })
    const model = fauxModel([assistantMessage([toolUse('hang', {})])])
    const r = createSession(createAgent({ model, tools: [hang], plugins: [retryTool(5)] })).send('go')

    // Act
    await started.promise
    r.abort()
    await r.result.catch(() => undefined)
    await new Promise(resolve => setTimeout(resolve, 10))

    // Assert
    expect(attempts).toBe(1)
  })
})

// Helpers

const registrations: Array<{ dispose: () => void }> = []
afterEach(() => {
  registrations.splice(0).forEach(r => r.dispose())
})

function fauxModel(responses: FakeReply[]): Model<Api> {
  const fake = createFakeModel(responses)
  registrations.push(fake)
  return fake.model
}

/** Retries a failed model call until it works or `limit` attempts are used; never after the step is cancelled. */
function retryModel(limit: number): Plugin {
  return definePlugin({
    name: 'retry-model',
    async *request(req, next, { signal }) {
      for (let attempt = 1; ; attempt++) {
        try {
          return yield* next(req)
        } catch (error) {
          signal.throwIfAborted()
          if (attempt >= limit) {
            throw error
          }
        }
      }
    },
  })
}

/** RFC-0006 §4.2: retries what a tool throws; a toolError is a result and never reaches the catch. */
function retryTool(limit: number): Plugin {
  return definePlugin({
    name: 'retry-tool',
    async *toolCall(call, next, { signal }) {
      for (let attempt = 1; ; attempt++) {
        signal.throwIfAborted()
        try {
          return yield* next(call)
        } catch (error) {
          signal.throwIfAborted()
          if (attempt >= limit) {
            throw error
          }
        }
      }
    },
  })
}

/** Logs entering and leaving every hook, and each reducer and observer call, under its plugin's name. */
function traced(name: string, log: string[]): Plugin<number> {
  const around = (hook: string) => (enter: boolean) => log.push(`${hook}${enter ? '>' : '<'} ${name}`)
  const [decide, request, toolCalls, toolCall] = ['decide', 'request', 'toolCalls', 'toolCall'].map(around)

  return definePlugin({
    name,
    async *decide(state, next) {
      decide(true)
      const result = yield* next(state)
      decide(false)
      return result
    },
    input: messages => {
      log.push(`input ${name}`)
      return messages
    },
    async *request(req, next) {
      request(true)
      const result = yield* next(req)
      request(false)
      return result
    },
    async *toolCalls(message, next) {
      toolCalls(true)
      const result = yield* next(message)
      toolCalls(false)
      return result
    },
    async *toolCall(call, next) {
      toolCall(true)
      const result = yield* next(call)
      toolCall(false)
      return result
    },
    record: (input, next) => {
      log.push(`record> ${name}`)
      const state = next(input)
      log.push(`record< ${name}`)
      return state
    },
    state: {
      init: 0,
      reduce: n => {
        log.push(`reduce ${name}`)
        return n + 1
      },
    },
    observe: () => {
      log.push(`observe ${name}`)
    },
  })
}

function pick(log: string[], ...prefixes: string[]): string[] {
  return log.filter(line => prefixes.some(prefix => line.startsWith(`${prefix} `) || line.startsWith(prefix)))
}

/** The log is `pattern` repeated once per call of the hook, at least once. */
function expectRepeats(log: string[], pattern: string[]): void {
  expect(log.length).toBeGreaterThan(0)
  expect(log.length % pattern.length).toBe(0)
  for (let i = 0; i < log.length; i += pattern.length) {
    expect(log.slice(i, i + pattern.length)).toEqual(pattern)
  }
}

function splitAt<T>(items: T[], starts: (item: T) => boolean): T[][] {
  const groups: T[][] = []
  for (const item of items) {
    if (starts(item) || groups.length === 0) {
      groups.push([item])
    } else {
      groups.at(-1)!.push(item)
    }
  }
  return groups
}

/** A faux response that records what the request carried and answers `text`. */
function seeRequest(
  seen: Array<{ system?: string; tools: number }>,
  text: string,
): (request: FakeRequest) => AssistantMessage {
  return request => {
    seen.push({
      system: request.system,
      tools: request.tools.length,
    })
    return assistantMessage(text)
  }
}

function gate(): { wait: () => Promise<void>; open: () => void; started: Promise<void> } {
  const opened = Promise.withResolvers<void>()
  const started = Promise.withResolvers<void>()
  return {
    wait: () => {
      started.resolve()
      return opened.promise
    },
    open: () => opened.resolve(),
    started: started.promise,
  }
}

function blockedUntil(g: ReturnType<typeof gate>, text: string): () => Promise<AssistantMessage> {
  return async () => {
    await g.wait()
    return assistantMessage(text)
  }
}

function modelEvents(events: RunEvent[]): string[] {
  return events.flatMap(e => {
    if (e.type !== 'model_start' && e.type !== 'model_end' && e.type !== 'model_error') {
      return []
    }
    return [e.by === undefined ? e.type : `${e.type} by ${e.by}`]
  })
}

/** Appendix A.6: at most one attempt open on any prefix, each start closed once, none left open at run_end. */
function expectAttemptsClosed(events: RunEvent[]): void {
  let open = 0
  let by: string | undefined

  for (const e of events) {
    if (e.type === 'model_start') {
      expect(open).toBe(0)
      open = 1
      by = e.by
    } else if (e.type === 'model_end' || e.type === 'model_error') {
      expect(open).toBe(1)
      expect(e.by).toBe(by)
      open = 0
    } else if (e.type === 'step_cancelled') {
      open = 0
    } else if (e.type === 'run_end') {
      expect(open).toBe(0)
    }
  }
}

/** Appendix A.7: the usage every model_end and model_error reported, summed independently of the Run. */
function billed(events: RunEvent[]): UsageTotals {
  const total: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }
  for (const e of events) {
    const usage = e.type === 'model_end' ? e.message.usage : e.type === 'model_error' ? e.usage : undefined
    if (usage !== undefined) {
      total.input += usage.input
      total.output += usage.output
      total.cacheRead += usage.cacheRead
      total.cacheWrite += usage.cacheWrite
      total.cost += usage.cost.total
    }
  }
  return total
}

function warningsOf(type: string): unknown[] {
  return vi.mocked(process.emitWarning).mock.calls.filter(call => call[1] === type)
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const all: T[] = []
  for await (const x of source) {
    all.push(x)
  }
  return all
}

/** Every event, run_end included, even when the run fails: its reader throws only after handing out run_end. */
async function read(r: AsyncIterable<RunEvent>): Promise<RunEvent[]> {
  const events: RunEvent[] = []
  try {
    for await (const e of r) {
      events.push(e)
    }
  } catch {}
  return events
}
