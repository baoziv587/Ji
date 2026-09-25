// Verifies RFC-0003 / RFC-0004 against pi-ai's faux provider: hooks, plugin state, Run, sessions and interjections
import type {
  Api,
  AssistantMessage,
  Context,
  FauxResponseStep,
  Message,
  Model,
  SimpleStreamOptions,
  ToolResultMessage,
} from '@mariozechner/pi-ai'
import type { AgentTool, PluginSpec, Turn, TurnEvent } from './index.ts'
import { fauxAssistantMessage, fauxText, fauxToolCall, registerFauxProvider, Type } from '@mariozechner/pi-ai'
import { describe, expect, it, onTestFinished } from 'vitest'
import {
  after,
  before,
  createAgent,
  createSession,
  definePlugin,
  PluginConflictError,
  rewriteHistory,
  textOf,
  tool,
  toolError,
  usageOf,
  user,
} from './index.ts'

const echo = tool({
  name: 'echo',
  description: 'upper-case x',
  parameters: Type.Object({ x: Type.String() }),
  run: ({ x }) => x.toUpperCase(),
})

const callEcho = (x: string): AssistantMessage =>
  fauxAssistantMessage([fauxToolCall('echo', { x })], { stopReason: 'toolUse' })

function fauxModel(responses: FauxResponseStep[], options?: { tokensPerSecond: number }): Model<Api> {
  const faux = registerFauxProvider(options)
  faux.setResponses(responses)
  onTestFinished(() => faux.unregister())
  return faux.getModel()
}

/** Replies `re:<last user message>`. */
function replyToLastUser(ctx: Context): AssistantMessage {
  const last = ctx.messages.findLast(m => m.role === 'user')
  return fauxAssistantMessage(`re:${last?.content}`)
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const all: T[] = []
  for await (const x of source) {
    all.push(x)
  }
  return all
}

function contentOf(m: Message): string {
  if (typeof m.content === 'string') {
    return m.content
  }
  return m.content.map(c => (c.type === 'text' ? c.text : c.type === 'toolCall' ? `->${c.name}` : '')).join('')
}

const kinds = (turns: TurnEvent[]): Turn['kind'][] => turns.map(e => e.turn.kind)

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

function tracer(name: string, log: string[]): PluginSpec {
  return {
    name,
    tool: async (ctx, next) => {
      log.push(`${name}>`)
      const result = await next(ctx)
      log.push(`<${name}`)
      return result
    },
  }
}

describe('basic run', () => {
  it('runs tools in parallel; schema validation failures go back to the model as isError results', async () => {
    const model = fauxModel([
      fauxAssistantMessage([fauxToolCall('echo', { x: 'hi' }), fauxToolCall('echo', { y: 1 })], {
        stopReason: 'toolUse',
      }),
      ctx => {
        const results = ctx.messages.filter((m): m is ToolResultMessage => m.role === 'toolResult')
        expect(results.map(r => r.isError)).toEqual([false, true])
        return fauxAssistantMessage(`got ${contentOf(results[0])}`)
      },
    ])
    const final = await createSession(createAgent({ model, tools: [echo] })).send('go').result
    expect(textOf(final)).toBe('got HI')
  })

  it('writes the final answer into state (S8)', async () => {
    const r = createSession(createAgent({ model: fauxModel([fauxAssistantMessage('ok')]) })).send('go')
    expect((await r.state).messages.at(-1)).toBe(await r.result)
  })

  it('on stopReason=error, result and summary reject and turns throws', async () => {
    const model = fauxModel([
      fauxAssistantMessage([fauxText('partial')], { stopReason: 'error', errorMessage: 'boom' }),
    ])
    const r = createSession(createAgent({ model })).send('go')

    await expect(r.result).rejects.toThrow(/boom/)
    await expect(r.summary).rejects.toThrow(/boom/)
    await expect(collect(r.turns)).rejects.toThrow(/boom/)
  })

  it('breaking out of r.text cancels the run and aborts the underlying request', async () => {
    let seen: AbortSignal | undefined
    const model = fauxModel(
      [
        (_ctx, opts) => {
          seen = opts?.signal
          return fauxAssistantMessage('a long long long long answer')
        },
      ],
      { tokensPerSecond: 20 },
    )
    const r = createSession(createAgent({ model })).send('go')

    let n = 0
    for await (const _ of r.text) {
      if (++n === 2) {
        break
      }
    }

    await expect(r.result).rejects.toThrow(/aborted/)
    expect(seen?.aborted).toBe(true)
  })

  it('raw events can still be read one by one', async () => {
    const r = createSession(createAgent({ model: fauxModel([fauxAssistantMessage('ok')]) })).send('go')
    const tags = (await collect(r)).map(e => e.tag)
    expect(tags.filter(t => t !== 'delta')).toEqual(['act', 'act', 'done'])
  })
})

describe('plugin middleware', () => {
  it('later plugins in the array wrap earlier ones', async () => {
    const log: string[] = []
    const model = fauxModel([callEcho('a'), fauxAssistantMessage('ok')])
    const plugins = [definePlugin(tracer('inner', log)), definePlugin(tracer('outer', log))]

    await createSession(createAgent({ model, tools: [echo], plugins })).send('go').result
    expect(log).toEqual(['outer>', 'inner>', '<inner', '<outer'])
  })

  it('not calling next intercepts: the tool does not run and the model gets an isError result', async () => {
    let ran = false
    const spy = tool({
      ...echo,
      run: () => {
        ran = true
        return ''
      },
    })
    const deny = definePlugin({ name: 'deny', tool: async ({ call }) => toolError(call, 'denied') })
    const model = fauxModel([
      callEcho('a'),
      ctx => {
        expect(ctx.messages.at(-1)).toMatchObject({ role: 'toolResult', isError: true })
        return fauxAssistantMessage('ok')
      },
    ])

    await createSession(createAgent({ model, tools: [spy], plugins: [deny] })).send('go').result
    expect(ran).toBe(false)
  })

  it('errors thrown by middleware become isError results and the agent keeps running (I8)', async () => {
    const boom = definePlugin({
      name: 'boom',
      tool: async () => {
        throw new Error('middleware failed')
      },
    })
    const model = fauxModel([
      callEcho('a'),
      ctx => {
        expect(ctx.messages.at(-1)).toMatchObject({
          isError: true,
          content: [{ text: 'middleware failed' }],
        })
        return fauxAssistantMessage('recovered')
      },
    ])

    const final = await createSession(createAgent({ model, plugins: [boom] })).send('go').result
    expect(textOf(final)).toBe('recovered')
  })

  it('system is transformed in plugin order', async () => {
    let prompt: string | undefined
    const model = fauxModel([
      ctx => {
        prompt = ctx.systemPrompt
        return fauxAssistantMessage('ok')
      },
    ])
    const a = definePlugin({ name: 'a', system: s => `${s}+A` })
    const b = definePlugin({ name: 'b', system: s => `${s}+B` })

    await createSession(createAgent({ model, system: 'S', plugins: [a, b] })).send('go').result
    expect(prompt).toBe('S+A+B')
  })

  it('nested arrays behave the same as flattened ones (guarantee 1)', async () => {
    const orders: string[][] = []

    for (const shape of ['left', 'right'] as const) {
      const log: string[] = []
      const [a, b, c] = ['a', 'b', 'c'].map(n => definePlugin(tracer(n, log)))
      const plugins = shape === 'left' ? [[a, b], c] : [a, [b, c]]
      const model = fauxModel([callEcho('x'), fauxAssistantMessage('ok')])

      await createSession(createAgent({ model, tools: [echo], plugins })).send('go').result
      orders.push(log)
    }
    expect(orders[0]).toEqual(orders[1])
  })
})

describe('conflict checks', () => {
  const model = registerFauxProvider().getModel()
  const echo2 = tool({ ...echo })

  it('reports all name conflicts at once (guarantee 3)', () => {
    const p1 = definePlugin({ name: 'dup', tools: [echo] })
    const p2 = definePlugin({ name: 'dup', tools: [echo2] })

    expect(() => createAgent({ model, plugins: [p1, p2] })).toThrow(PluginConflictError)
    try {
      createAgent({ model, plugins: [p1, p2] })
    } catch (e) {
      expect((e as PluginConflictError).conflicts).toEqual({ tools: ['echo'], plugins: ['dup'] })
    }
  })

  it('registering the same object twice is not a conflict', () => {
    const p = definePlugin({ name: 'p', tools: [echo] })
    expect(() => createAgent({ model, tools: [echo], plugins: [p, p] })).not.toThrow()
  })
})

describe('plugin state', () => {
  const modelTurns = definePlugin({
    name: 'model-turns',
    state: { init: 0, reduce: (n, turn) => (turn.kind === 'model' ? n + 1 : n) },
  })

  it('calls reduce on every step including the final answer; select returns init before any write', async () => {
    const model = fauxModel([callEcho('a'), callEcho('b'), fauxAssistantMessage('ok')])
    const state = await createSession(createAgent({ model, tools: [echo], plugins: [modelTurns] })).send('go').state

    expect(modelTurns.select(state)).toBe(3)
    expect(modelTurns.select({ messages: [], plugins: {} })).toBe(0)
  })

  it('hot swap: a new plugin list continues from the same state, new plugins start from init (guarantee 4)', async () => {
    const first = await createSession(
      createAgent({ model: fauxModel([callEcho('a'), fauxAssistantMessage('ok')]), tools: [echo] }),
    ).send('go').state

    const model = fauxModel([fauxAssistantMessage('again')])
    const second = await createSession(createAgent({ model, plugins: [modelTurns] }), {
      state: first,
    }).send('again').state

    expect(second.messages.slice(0, first.messages.length)).toEqual(first.messages)
    expect(modelTurns.select(second)).toBe(1)
  })
})

describe('hooks', () => {
  it('input: continues once automatically when the agent is idle', async () => {
    const keepGoing = definePlugin({
      name: 'keep-going',
      input: (messages, { state, idle }) => {
        const continued = state.messages.some(m => m.content === 'continue')
        return idle && messages.length === 0 && !continued ? [user('continue')] : messages
      },
    })
    const model = fauxModel([replyToLastUser, replyToLastUser])

    const state = await createSession(createAgent({ model, plugins: [keepGoing] })).send('go').state
    expect(state.messages.map(contentOf)).toEqual(['go', 're:go', 'continue', 're:continue'])
  })

  it('context: changes only this request, not the history', async () => {
    const lastOnly = definePlugin({ name: 'last-only', context: messages => messages.slice(-1) })
    const model = fauxModel([
      callEcho('a'),
      ctx => {
        expect(ctx.messages.map(m => m.role)).toEqual(['toolResult'])
        return fauxAssistantMessage('ok')
      },
    ])

    const state = await createSession(createAgent({ model, tools: [echo], plugins: [lastOnly] })).send('go').state
    expect(state.messages).toHaveLength(4)
  })

  it('request: before changes the request, after changes the final message, deltas pass through', async () => {
    const plugin = definePlugin({
      name: 'request',
      request: before(req => ({ ...req, systemPrompt: 'patched' })),
    })
    const outer = definePlugin({
      name: 'outer',
      request: after(msg => ({ ...msg, content: [{ type: 'text', text: 'replaced' }] })),
    })
    const model = fauxModel([ctx => fauxAssistantMessage(`prompt=${ctx.systemPrompt}`)])
    const r = createSession(createAgent({ model, system: 'S', plugins: [plugin, outer] })).send('go')

    expect((await collect(r.text)).join('')).toBe('prompt=patched')
    expect(textOf(await r.result)).toBe('replaced')
  })

  it('tool: after changes only the output', async () => {
    const redact = definePlugin({
      name: 'redact',
      tool: after(result => ({ ...result, content: [{ type: 'text', text: '***' }] })),
    })
    const model = fauxModel([
      callEcho('secret'),
      ctx => {
        expect(contentOf(ctx.messages.at(-1)!)).toBe('***')
        return fauxAssistantMessage('ok')
      },
    ])

    await createSession(createAgent({ model, tools: [echo], plugins: [redact] })).send('go').result
  })

  it('update sees every Turn', async () => {
    const seen: Turn['kind'][] = []
    const spy = definePlugin({
      name: 'spy',
      update: (state, turn, next) => {
        seen.push(turn.kind)
        return next(state, turn)
      },
    })
    const model = fauxModel([callEcho('a'), fauxAssistantMessage('ok')])

    await createSession(createAgent({ model, tools: [echo], plugins: [spy] })).send('go').result
    expect(seen).toEqual(['input', 'model', 'model'])
  })
})

describe('reasoning levels', () => {
  /** Like DeepSeek, supports only high and xhigh; records the reasoning each request actually carries. */
  function thinker(seen: unknown[], { reasoning = true, calls = 1 } = {}): Model<Api> {
    const faux = registerFauxProvider({ models: [{ id: 'thinker', reasoning }] })
    faux.setResponses(
      Array.from({ length: calls }, () => (_ctx: Context, options: SimpleStreamOptions | undefined) => {
        seen.push(options?.reasoning)
        return fauxAssistantMessage('ok')
      }),
    )
    onTestFinished(() => faux.unregister())
    return {
      ...faux.getModel(),
      thinkingLevelMap: { minimal: null, low: null, medium: null, high: 'high', xhigh: 'max' },
    }
  }

  it('passes supported levels through, maps unsupported ones to the nearest available, omits it when unset', async () => {
    const seen: unknown[] = []
    const model = thinker(seen, { calls: 3 })

    for (const reasoning of ['xhigh', 'medium', undefined] as const) {
      await createSession(createAgent({ model, reasoning })).send('go').result
    }
    expect(seen).toEqual(['xhigh', 'high', undefined])
  })

  it('drops reasoning when the model cannot reason', async () => {
    const seen: unknown[] = []
    const model = thinker(seen, { reasoning: false })

    await createSession(createAgent({ model, reasoning: 'high' })).send('go').result
    expect(seen).toEqual([undefined])
  })

  it('a request plugin can change the level per request, still validated against the model', async () => {
    const seen: unknown[] = []
    const think = definePlugin({
      name: 'think',
      request: before(req => ({ ...req, options: { ...req.options, reasoning: 'low' } })),
    })

    await createSession(createAgent({ model: thinker(seen), plugins: [think] })).send('go').result
    expect(seen).toEqual(['high'])
  })
})

describe('rewriteHistory', () => {
  it('policy returning rewriteHistory replaces the history; env is skipped, update and state see the rewrite', async () => {
    let envCalls = 0
    const seen: Turn['kind'][] = []
    const compact = definePlugin({
      name: 'compact',
      async *policy(state, next) {
        if (state.messages.length >= 3 && state.messages[0].content !== 'summary') {
          return rewriteHistory([user('summary')])
        }
        return yield* next(state)
      },
      env: (msg, next) => {
        envCalls++
        return next(msg)
      },
      update: (s, turn, next) => {
        seen.push(turn.kind)
        return next(s, turn)
      },
      state: { init: 0, reduce: (n, turn) => (turn.kind === 'rewrite' ? n + 1 : n) },
    })
    const model = fauxModel([
      callEcho('a'),
      ctx => {
        expect(ctx.messages.map(contentOf)).toEqual(['summary'])
        return fauxAssistantMessage('ok')
      },
    ])

    const r = createSession(createAgent({ model, tools: [echo], plugins: [compact] })).send('go')
    const state = await r.state

    expect(state.messages.map(contentOf)).toEqual(['summary', 'ok'])
    expect([envCalls, compact.select(state), (await r.summary).rewrites]).toEqual([1, 1, 1])
    expect(seen).toEqual(['input', 'model', 'rewrite', 'model'])
  })
})

describe('run records and stats', () => {
  const failing = tool({
    ...echo,
    name: 'fail',
    run: () => {
      throw new Error('nope')
    },
  })

  it('summary counts model turns, usage, tool calls and errors, and inserted messages', async () => {
    const model = fauxModel([
      fauxAssistantMessage([fauxToolCall('echo', { x: 'a' }), fauxToolCall('fail', { x: 'b' })], {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage('ok'),
    ])
    const r = createSession(createAgent({ model, tools: [echo, failing] })).send('go')
    const summary = await r.summary

    expect(summary).toMatchObject({ turns: 2, inputs: 1, rewrites: 0 })
    expect(summary.tools).toMatchObject({
      echo: { calls: 1, errors: 0 },
      fail: { calls: 1, errors: 1 },
    })
    expect(summary.usage.input).toBeGreaterThan(0)
    expect(summary.usage).toEqual(usageOf(await r.state))
  })

  it('turns always starts from the first step; the last summary equals r.summary (guarantee 5)', async () => {
    const model = fauxModel([callEcho('a'), fauxAssistantMessage('ok')])
    const r = createSession(createAgent({ model, tools: [echo] })).send('go')

    await collect(r.text)
    const turns = await collect(r.turns)

    expect(kinds(turns)).toEqual(['input', 'model', 'model'])
    expect(turns.map(e => e.t)).toEqual([0, 1, 2])
    expect(turns.at(-1)?.summary).toEqual(await r.summary)
  })

  it('model turns record timing: first token, model, and each tool', async () => {
    const model = fauxModel([callEcho('a'), fauxAssistantMessage('ok')])
    const turns = await collect(createSession(createAgent({ model, tools: [echo] })).send('go').turns)
    const [, withTool, final] = turns

    expect(withTool.timing.firstTokenMs).toBeTypeOf('number')
    expect(Object.keys(withTool.timing.toolMs ?? {})).toHaveLength(1)
    expect(final.timing.modelMs).toBeTypeOf('number')
    expect(turns[0].timing.modelMs).toBeUndefined()
  })
})

describe('sessions and interjections', () => {
  const blocked = (g: ReturnType<typeof gate>): AgentTool =>
    tool({
      name: 'wait',
      description: 'wait for the gate',
      parameters: Type.Object({}),
      run: async () => {
        await g.wait()
        return 'opened'
      },
    })
  const callWait = fauxAssistantMessage([fauxToolCall('wait', {})], { stopReason: 'toolUse' })

  it('send during a run returns the same Run; send after it ends starts a new Run', async () => {
    const g = gate()
    const chat = createSession(
      createAgent({
        model: fauxModel([callWait, replyToLastUser, replyToLastUser, replyToLastUser]),
        tools: [blocked(g)],
      }),
    )

    const first = chat.send('go')
    await g.started
    expect(chat.send('more')).toBe(first)

    g.open()
    await first.result
    const second = chat.send('next')
    expect(second).not.toBe(first)
    expect(textOf(await second.result)).toBe('re:next')
  })

  it('steer is inserted at the next step boundary; follow-up waits until the agent is idle', async () => {
    const g = gate()
    const model = fauxModel([
      callWait,
      ctx => {
        expect(ctx.messages.map(m => m.role)).toEqual(['user', 'assistant', 'toolResult', 'user'])
        return replyToLastUser(ctx)
      },
      replyToLastUser,
    ])
    const chat = createSession(createAgent({ model, tools: [blocked(g)] }))

    const r = chat.send('go')
    await g.started
    chat.send('follow')
    chat.send('steer', { when: 'step' })
    g.open()

    const turns = await collect(r.turns)
    const inputs = turns.flatMap(e =>
      e.turn.kind === 'input' ? [{ text: contentOf(e.turn.messages[0]), idle: e.turn.idle }] : [],
    )

    expect(inputs).toEqual([
      { text: 'go', idle: true },
      { text: 'steer', idle: false },
      { text: 'follow', idle: true },
    ])
    expect((await r.state).messages.map(contentOf).slice(-4)).toEqual(['steer', 're:steer', 'follow', 're:follow'])
  })

  it('queued follow-ups equal sending them one by one (guarantee 7, S1)', async () => {
    const script = (): FauxResponseStep[] => [
      callEcho('a'),
      ...Array.from<FauxResponseStep>({ length: 6 }).fill(replyToLastUser),
    ]

    const queued = createSession(createAgent({ model: fauxModel(script()), tools: [echo] }))
    const r = queued.send('a')
    queued.send('b')
    queued.send('c')
    const together = await r.state

    const sequential = createSession(createAgent({ model: fauxModel(script()), tools: [echo] }))
    for (const text of ['a', 'b', 'c']) {
      await sequential.send(text).result
    }

    expect(together.messages.map(contentOf)).toEqual(sequential.state.messages.map(contentOf))
  })

  it('interrupt: cancels a streaming model turn without a trace (guarantee 9, S4)', async () => {
    const model = fauxModel(
      [fauxAssistantMessage('a very long answer that will be cut off before it finishes streaming'), replyToLastUser],
      { tokensPerSecond: 20 },
    )
    const chat = createSession(createAgent({ model }))

    const r = chat.send('first')
    let n = 0
    for await (const _ of r.text) {
      if (++n === 2) {
        chat.send('stop', { when: 'now' })
      }
    }

    const turns = await collect(r.turns)
    expect((await r.state).messages.map(contentOf)).toEqual(['first', 'stop', 're:stop'])
    expect(turns.map(e => (e.turn.kind === 'input' ? e.turn.interrupted : null))).toEqual([false, true, null])
  })

  it('interrupt: cancels running tools and discards that model turn', async () => {
    const started = Promise.withResolvers<void>()
    const hang = tool({
      name: 'hang',
      description: 'never finishes unless aborted',
      parameters: Type.Object({}),
      run: (_args, signal) =>
        new Promise<string>((_resolve, reject) => {
          started.resolve()
          signal.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    })
    const model = fauxModel([
      fauxAssistantMessage([fauxToolCall('hang', {})], { stopReason: 'toolUse' }),
      replyToLastUser,
    ])
    const chat = createSession(createAgent({ model, tools: [hang] }))

    const r = chat.send('go')
    await started.promise
    chat.send('stop', { when: 'now' })

    expect((await r.state).messages.map(contentOf)).toEqual(['go', 'stop', 're:stop'])
  })

  it('abort: undelivered messages stay in the session for the next run', async () => {
    const model = fauxModel(
      [
        fauxAssistantMessage('a very long answer that will be aborted'),
        replyToLastUser,
        replyToLastUser,
        replyToLastUser,
      ],
      { tokensPerSecond: 20 },
    )
    const chat = createSession(createAgent({ model }))

    const r = chat.send('first')
    chat.send('later')
    await r.text[Symbol.asyncIterator]().next() // wait for the first text delta
    r.abort()

    await expect(r.result).rejects.toThrow(/aborted/)
    expect(chat.pending.map(p => contentOf(p.message))).toEqual(['later'])

    const next = chat.send('last')
    await next.result
    expect(chat.state.messages.map(contentOf)).toEqual(['first', 're:first', 'later', 're:later', 'last', 're:last'])
    expect(chat.pending).toEqual([])
  })

  it('messages whose custom condition fails keep waiting and the run ends normally', async () => {
    const chat = createSession(createAgent({ model: fauxModel([replyToLastUser]) }))
    const r = chat.send('go')
    chat.send('never', { when: () => false })

    await r.result
    expect(chat.pending.map(p => contentOf(p.message))).toEqual(['never'])
  })
})
