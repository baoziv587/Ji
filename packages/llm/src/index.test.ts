// 用 pi-ai 的 faux provider 验证 RFC-0003 / RFC-0004：钩子、插件状态、Run、会话与插话
import type { Api, AssistantMessage, Context, FauxResponseStep, Message, Model, ToolResultMessage } from '@mariozechner/pi-ai'
import type { AgentTool, PluginSpec, Turn, TurnEvent } from './index.ts'
import { fauxAssistantMessage, fauxText, fauxToolCall, registerFauxProvider, Type } from '@mariozechner/pi-ai'
import { describe, expect, it, onTestFinished } from 'vitest'
import { after, before, createAgent, createSession, definePlugin, PluginConflictError, rewriteHistory, textOf, tool, toolError, usageOf, user } from './index.ts'

/* ── 测试工具 ───────────────────────────────────────── */

const echo = tool({
  name: 'echo',
  description: 'upper-case x',
  parameters: Type.Object({ x: Type.String() }),
  run: ({ x }) => x.toUpperCase(),
})

const callEcho = (x: string): AssistantMessage => fauxAssistantMessage([fauxToolCall('echo', { x })], { stopReason: 'toolUse' })

function fauxModel(responses: FauxResponseStep[], options?: { tokensPerSecond: number }): Model<Api> {
  const faux = registerFauxProvider(options)
  faux.setResponses(responses)
  onTestFinished(() => faux.unregister())
  return faux.getModel()
}

/** 一问一答：回答「re:最后一条用户消息」 */
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
  return m.content.map(c => (c.type === 'text' ? c.text : c.type === 'toolCall' ? `→${c.name}` : '')).join('')
}

const kinds = (turns: TurnEvent[]): Turn['kind'][] => turns.map(e => e.turn.kind)

/** 手动控制的闸门：工具在 wait() 上等待，测试在合适的时刻 open() */
function gate(): { wait: () => Promise<void>, open: () => void, started: Promise<void> } {
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

/** 记录进出顺序的工具中间件 */
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

/* ── 基本运行 ───────────────────────────────────────── */

describe('基本运行', () => {
  it('工具并行执行，schema 校验失败作为 isError 结果交还模型', async () => {
    const model = fauxModel([
      fauxAssistantMessage([fauxToolCall('echo', { x: 'hi' }), fauxToolCall('echo', { y: 1 })], { stopReason: 'toolUse' }),
      (ctx) => {
        const results = ctx.messages.filter((m): m is ToolResultMessage => m.role === 'toolResult')
        expect(results.map(r => r.isError)).toEqual([false, true])
        return fauxAssistantMessage(`got ${contentOf(results[0])}`)
      },
    ])
    const final = await createSession(createAgent({ model, tools: [echo] })).send('go').result
    expect(textOf(final)).toBe('got HI')
  })

  it('最终回答写入状态（S8）', async () => {
    const r = createSession(createAgent({ model: fauxModel([fauxAssistantMessage('ok')]) })).send('go')
    expect((await r.state).messages.at(-1)).toBe(await r.result)
  })

  it('stopReason=error 时 result 和 summary reject，turns 抛出', async () => {
    const model = fauxModel([fauxAssistantMessage([fauxText('partial')], { stopReason: 'error', errorMessage: 'boom' })])
    const r = createSession(createAgent({ model })).send('go')

    await expect(r.result).rejects.toThrow(/boom/)
    await expect(r.summary).rejects.toThrow(/boom/)
    await expect(collect(r.turns)).rejects.toThrow(/boom/)
  })

  it('提前退出 r.text 会取消运行，底层请求被 abort', async () => {
    let seen: AbortSignal | undefined
    const model = fauxModel([(_ctx, opts) => {
      seen = opts?.signal
      return fauxAssistantMessage('a long long long long answer')
    }], { tokensPerSecond: 20 })
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

  it('底层事件仍然可以逐个读取', async () => {
    const r = createSession(createAgent({ model: fauxModel([fauxAssistantMessage('ok')]) })).send('go')
    const tags = (await collect(r)).map(e => e.tag)
    expect(tags.filter(t => t !== 'delta')).toEqual(['act', 'act', 'done'])
  })
})

/* ── 插件中间件（RFC-0003） ─────────────────────────── */

describe('插件中间件', () => {
  it('数组中后面的插件在外层', async () => {
    const log: string[] = []
    const model = fauxModel([callEcho('a'), fauxAssistantMessage('ok')])
    const plugins = [definePlugin(tracer('inner', log)), definePlugin(tracer('outer', log))]

    await createSession(createAgent({ model, tools: [echo], plugins })).send('go').result
    expect(log).toEqual(['outer>', 'inner>', '<inner', '<outer'])
  })

  it('不调用 next 即拦截：工具不执行，模型收到 isError 结果', async () => {
    let ran = false
    const spy = tool({
      ...echo,
      run: () => {
        ran = true
        return ''
      },
    })
    const deny = definePlugin({ name: 'deny', tool: async ({ call }) => toolError(call, 'denied') })
    const model = fauxModel([callEcho('a'), (ctx) => {
      expect(ctx.messages.at(-1)).toMatchObject({ role: 'toolResult', isError: true })
      return fauxAssistantMessage('ok')
    }])

    await createSession(createAgent({ model, tools: [spy], plugins: [deny] })).send('go').result
    expect(ran).toBe(false)
  })

  it('中间件抛出的异常转为 isError 结果，agent 继续运行（I8）', async () => {
    const boom = definePlugin({
      name: 'boom',
      tool: async () => {
        throw new Error('middleware failed')
      },
    })
    const model = fauxModel([callEcho('a'), (ctx) => {
      expect(ctx.messages.at(-1)).toMatchObject({ isError: true, content: [{ text: 'middleware failed' }] })
      return fauxAssistantMessage('recovered')
    }])

    const final = await createSession(createAgent({ model, plugins: [boom] })).send('go').result
    expect(textOf(final)).toBe('recovered')
  })

  it('system 按插件顺序依次修改', async () => {
    let prompt: string | undefined
    const model = fauxModel([(ctx) => {
      prompt = ctx.systemPrompt
      return fauxAssistantMessage('ok')
    }])
    const a = definePlugin({ name: 'a', system: s => `${s}+A` })
    const b = definePlugin({ name: 'b', system: s => `${s}+B` })

    await createSession(createAgent({ model, system: 'S', plugins: [a, b] })).send('go').result
    expect(prompt).toBe('S+A+B')
  })

  it('嵌套数组与拍平后的数组行为相同（承诺 1）', async () => {
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

describe('冲突检查', () => {
  const model = registerFauxProvider().getModel()
  const echo2 = tool({ ...echo })

  it('重名一次报全（承诺 3）', () => {
    const p1 = definePlugin({ name: 'dup', tools: [echo] })
    const p2 = definePlugin({ name: 'dup', tools: [echo2] })

    expect(() => createAgent({ model, plugins: [p1, p2] })).toThrow(PluginConflictError)
    try {
      createAgent({ model, plugins: [p1, p2] })
    }
    catch (e) {
      expect((e as PluginConflictError).conflicts).toEqual({ tools: ['echo'], plugins: ['dup'] })
    }
  })

  it('同一个对象登记多次不算冲突', () => {
    const p = definePlugin({ name: 'p', tools: [echo] })
    expect(() => createAgent({ model, tools: [echo], plugins: [p, p] })).not.toThrow()
  })
})

/* ── 插件状态 ───────────────────────────────────────── */

describe('插件状态', () => {
  const modelTurns = definePlugin({
    name: 'model-turns',
    state: { init: 0, reduce: (n, turn) => (turn.kind === 'model' ? n + 1 : n) },
  })

  it('每一步都调用 reduce，包括最终回答；未写入时 select 返回 init', async () => {
    const model = fauxModel([callEcho('a'), callEcho('b'), fauxAssistantMessage('ok')])
    const state = await createSession(createAgent({ model, tools: [echo], plugins: [modelTurns] })).send('go').state

    expect(modelTurns.select(state)).toBe(3)
    expect(modelTurns.select({ messages: [], plugins: {} })).toBe(0)
  })

  it('热插拔：换插件列表后从同一个状态继续，新插件从 init 开始（承诺 4）', async () => {
    const first = await createSession(createAgent({ model: fauxModel([callEcho('a'), fauxAssistantMessage('ok')]), tools: [echo] })).send('go').state

    const model = fauxModel([fauxAssistantMessage('again')])
    const second = await createSession(createAgent({ model, plugins: [modelTurns] }), { state: first }).send('again').state

    expect(second.messages.slice(0, first.messages.length)).toEqual(first.messages)
    expect(modelTurns.select(second)).toBe(1)
  })
})

/* ── 钩子（RFC-0004 §4） ────────────────────────────── */

describe('钩子', () => {
  it('input：agent 空闲时自动继续一次', async () => {
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

  it('context：只改这一次请求，不改历史', async () => {
    const lastOnly = definePlugin({ name: 'last-only', context: messages => messages.slice(-1) })
    const model = fauxModel([callEcho('a'), (ctx) => {
      expect(ctx.messages.map(m => m.role)).toEqual(['toolResult'])
      return fauxAssistantMessage('ok')
    }])

    const state = await createSession(createAgent({ model, tools: [echo], plugins: [lastOnly] })).send('go').state
    expect(state.messages).toHaveLength(4)
  })

  it('request：before 改请求，after 改最终消息，增量照常转发', async () => {
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

  it('tool：after 只改输出', async () => {
    const redact = definePlugin({ name: 'redact', tool: after(result => ({ ...result, content: [{ type: 'text', text: '***' }] })) })
    const model = fauxModel([callEcho('secret'), (ctx) => {
      expect(contentOf(ctx.messages.at(-1)!)).toBe('***')
      return fauxAssistantMessage('ok')
    }])

    await createSession(createAgent({ model, tools: [echo], plugins: [redact] })).send('go').result
  })

  it('update 看到所有 Turn', async () => {
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

describe('rewriteHistory', () => {
  it('policy 返回 rewriteHistory：历史被替换；env 不经过，update 和 state 看到 rewrite', async () => {
    let envCalls = 0
    const seen: Turn['kind'][] = []
    const compact = definePlugin({
      name: 'compact',
      async* policy(state, next) {
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
    const model = fauxModel([callEcho('a'), (ctx) => {
      expect(ctx.messages.map(contentOf)).toEqual(['summary'])
      return fauxAssistantMessage('ok')
    }])

    const r = createSession(createAgent({ model, tools: [echo], plugins: [compact] })).send('go')
    const state = await r.state

    expect(state.messages.map(contentOf)).toEqual(['summary', 'ok'])
    expect([envCalls, compact.select(state), (await r.summary).rewrites]).toEqual([1, 1, 1])
    expect(seen).toEqual(['input', 'model', 'rewrite', 'model'])
  })
})

/* ── Run：记录与统计（RFC-0004 §6） ─────────────────── */

describe('记录与统计（Run）', () => {
  const failing = tool({
    ...echo,
    name: 'fail',
    run: () => {
      throw new Error('nope')
    },
  })

  it('summary 统计模型回合、用量、工具调用与出错、插入的消息', async () => {
    const model = fauxModel([
      fauxAssistantMessage([fauxToolCall('echo', { x: 'a' }), fauxToolCall('fail', { x: 'b' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('ok'),
    ])
    const r = createSession(createAgent({ model, tools: [echo, failing] })).send('go')
    const summary = await r.summary

    expect(summary).toMatchObject({ turns: 2, inputs: 1, rewrites: 0 })
    expect(summary.tools).toMatchObject({ echo: { calls: 1, errors: 0 }, fail: { calls: 1, errors: 1 } })
    expect(summary.usage.input).toBeGreaterThan(0)
    expect(summary.usage).toEqual(usageOf(await r.state))
  })

  it('turns 无论何时读都从第一步开始；最后一条的 summary 等于 r.summary（承诺 5）', async () => {
    const model = fauxModel([callEcho('a'), fauxAssistantMessage('ok')])
    const r = createSession(createAgent({ model, tools: [echo] })).send('go')

    await collect(r.text)
    const turns = await collect(r.turns)

    expect(kinds(turns)).toEqual(['input', 'model', 'model'])
    expect(turns.map(e => e.t)).toEqual([0, 1, 2])
    expect(turns.at(-1)?.summary).toEqual(await r.summary)
  })

  it('模型回合带耗时：首 token、模型、每个工具', async () => {
    const model = fauxModel([callEcho('a'), fauxAssistantMessage('ok')])
    const turns = await collect(createSession(createAgent({ model, tools: [echo] })).send('go').turns)
    const [, withTool, final] = turns

    expect(withTool.timing.firstTokenMs).toBeTypeOf('number')
    expect(Object.keys(withTool.timing.toolMs ?? {})).toHaveLength(1)
    expect(final.timing.modelMs).toBeTypeOf('number')
    expect(turns[0].timing.modelMs).toBeUndefined()
  })
})

/* ── 会话与插话（RFC-0004 §7） ──────────────────────── */

describe('会话与插话', () => {
  const blocked = (g: ReturnType<typeof gate>): AgentTool => tool({
    name: 'wait',
    description: 'wait for the gate',
    parameters: Type.Object({}),
    run: async () => {
      await g.wait()
      return 'opened'
    },
  })
  const callWait = fauxAssistantMessage([fauxToolCall('wait', {})], { stopReason: 'toolUse' })

  it('运行中 send 返回同一个 Run；结束后 send 开始新的 Run', async () => {
    const g = gate()
    const chat = createSession(createAgent({ model: fauxModel([callWait, replyToLastUser, replyToLastUser, replyToLastUser]), tools: [blocked(g)] }))

    const first = chat.send('go')
    await g.started
    expect(chat.send('more')).toBe(first)

    g.open()
    await first.result
    const second = chat.send('next')
    expect(second).not.toBe(first)
    expect(textOf(await second.result)).toBe('re:next')
  })

  it('steer 在下一个步边界插入；follow-up 等 agent 空闲后插入', async () => {
    const g = gate()
    const model = fauxModel([
      callWait,
      (ctx) => {
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
    const inputs = turns.flatMap(e => (e.turn.kind === 'input' ? [{ text: contentOf(e.turn.messages[0]), idle: e.turn.idle }] : []))

    expect(inputs).toEqual([{ text: 'go', idle: true }, { text: 'steer', idle: false }, { text: 'follow', idle: true }])
    expect((await r.state).messages.map(contentOf).slice(-4)).toEqual(['steer', 're:steer', 'follow', 're:follow'])
  })

  it('排队的 follow-up 等于依次发送（承诺 7，S1）', async () => {
    const script = (): FauxResponseStep[] => [callEcho('a'), ...Array.from<FauxResponseStep>({ length: 6 }).fill(replyToLastUser)]

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

  it('interrupt：取消正在输出的模型回合，不留痕迹（承诺 9，S4）', async () => {
    const model = fauxModel([
      fauxAssistantMessage('a very long answer that will be cut off before it finishes streaming'),
      replyToLastUser,
    ], { tokensPerSecond: 20 })
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

  it('interrupt：取消正在执行的工具，这个模型回合被丢弃', async () => {
    const started = Promise.withResolvers<void>()
    const hang = tool({
      name: 'hang',
      description: 'never finishes unless aborted',
      parameters: Type.Object({}),
      run: (_args, signal) => new Promise<string>((_resolve, reject) => {
        started.resolve()
        signal.addEventListener('abort', () => reject(new Error('aborted')))
      }),
    })
    const model = fauxModel([fauxAssistantMessage([fauxToolCall('hang', {})], { stopReason: 'toolUse' }), replyToLastUser])
    const chat = createSession(createAgent({ model, tools: [hang] }))

    const r = chat.send('go')
    await started.promise
    chat.send('stop', { when: 'now' })

    expect((await r.state).messages.map(contentOf)).toEqual(['go', 'stop', 're:stop'])
  })

  it('abort：尚未送达的消息留在会话里，下一次运行处理', async () => {
    const model = fauxModel([
      fauxAssistantMessage('a very long answer that will be aborted'),
      replyToLastUser,
      replyToLastUser,
      replyToLastUser,
    ], { tokensPerSecond: 20 })
    const chat = createSession(createAgent({ model }))

    const r = chat.send('first')
    chat.send('later')
    await r.text[Symbol.asyncIterator]().next() // 等到第一段文字
    r.abort()

    await expect(r.result).rejects.toThrow(/aborted/)
    expect(chat.pending.map(p => contentOf(p.message))).toEqual(['later'])

    const next = chat.send('last')
    await next.result
    expect(chat.state.messages.map(contentOf)).toEqual(['first', 're:first', 'later', 're:later', 'last', 're:last'])
    expect(chat.pending).toEqual([])
  })

  it('自定义条件不成立的消息继续等待，运行照常结束', async () => {
    const chat = createSession(createAgent({ model: fauxModel([replyToLastUser]) }))
    const r = chat.send('go')
    chat.send('never', { when: () => false })

    await r.result
    expect(chat.pending.map(p => contentOf(p.message))).toEqual(['never'])
  })
})
