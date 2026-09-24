// 用 pi-ai 的 faux provider 验证：基础回合、插件中间件、冲突检查、插件状态
import type { Api, AssistantMessage, FauxResponseStep, Model } from '@mariozechner/pi-ai'
import type { AgentInput, AgentState, LLMAgent, PluginSpec } from './index.ts'
import { fauxAssistantMessage, fauxText, fauxToolCall, registerFauxProvider, Type } from '@mariozechner/pi-ai'
import { describe, expect, it, onTestFinished } from 'vitest'
import { createAgent, definePlugin, isHistoryRewrite, PluginConflictError, rewriteHistory, run, stream, textOf, tool, toolError, user } from './index.ts'

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

async function finalState(agent: LLMAgent, input: AgentInput): Promise<AgentState> {
  for await (const e of stream(agent, input)) {
    if (e.tag === 'done') {
      return e.state
    }
  }
  throw new Error('agent did not finish')
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

describe('createAgent', () => {
  it('回合：工具并行执行，schema 校验失败作为 isError 结果交还模型', async () => {
    const model = fauxModel([
      fauxAssistantMessage([fauxToolCall('echo', { x: 'hi' }), fauxToolCall('echo', { y: 1 })], { stopReason: 'toolUse' }),
      (ctx) => {
        const results = ctx.messages.filter(m => m.role === 'toolResult')
        expect(results.map(r => r.isError)).toEqual([false, true])
        const first = results[0].content[0]
        return fauxAssistantMessage(`got ${first.type === 'text' ? first.text : ''}`)
      },
    ])
    const final = await run(createAgent({ model, tools: [echo] }), [user('go')])
    expect(textOf(final)).toBe('got HI')
  })

  it('stopReason=error 会抛出', async () => {
    const model = fauxModel([fauxAssistantMessage([fauxText('partial')], { stopReason: 'error', errorMessage: 'boom' })])
    await expect(run(createAgent({ model }), [user('go')])).rejects.toThrow(/boom/)
  })

  it('取消：break 后底层请求被 abort', async () => {
    let seen: AbortSignal | undefined
    const model = fauxModel([(_ctx, opts) => {
      seen = opts?.signal
      return fauxAssistantMessage('a long long long long answer')
    }], { tokensPerSecond: 20 })

    let n = 0
    for await (const e of stream(createAgent({ model }), [user('go')])) {
      if (e.tag === 'delta' && e.delta.type === 'text_delta' && ++n === 2) {
        break
      }
    }
    expect(seen?.aborted).toBe(true)
  })
})

describe('插件中间件', () => {
  it('数组中后面的插件在外层', async () => {
    const log: string[] = []
    const model = fauxModel([callEcho('a'), fauxAssistantMessage('ok')])
    await run(createAgent({ model, tools: [echo], plugins: [definePlugin(tracer('inner', log)), definePlugin(tracer('outer', log))] }), [user('go')])
    expect(log).toEqual(['outer>', 'inner>', '<inner', '<outer'])
  })

  it('不调用 next 即拦截：工具不执行，模型收到 isError 结果', async () => {
    let ran = false
    const spy = tool({ ...echo, run: () => {
      ran = true
      return ''
    } })
    const deny = definePlugin({ name: 'deny', tool: async ({ call }) => toolError(call, 'denied') })
    const model = fauxModel([callEcho('a'), (ctx) => {
      const result = ctx.messages.at(-1)
      expect(result).toMatchObject({ role: 'toolResult', isError: true })
      return fauxAssistantMessage('ok')
    }])

    await run(createAgent({ model, tools: [spy], plugins: [deny] }), [user('go')])
    expect(ran).toBe(false)
  })

  it('中间件抛出的异常转为 isError 结果，agent 继续运行（I8）', async () => {
    const boom = definePlugin({ name: 'boom', tool: async () => {
      throw new Error('middleware failed')
    } })
    const model = fauxModel([callEcho('a'), (ctx) => {
      expect(ctx.messages.at(-1)).toMatchObject({ isError: true, content: [{ text: 'middleware failed' }] })
      return fauxAssistantMessage('recovered')
    }])

    expect(textOf(await run(createAgent({ model, plugins: [boom] }), [user('go')]))).toBe('recovered')
  })

  it('system 按插件顺序依次修改', async () => {
    let prompt: string | undefined
    const model = fauxModel([(ctx) => {
      prompt = ctx.systemPrompt
      return fauxAssistantMessage('ok')
    }])
    const a = definePlugin({ name: 'a', system: s => `${s}+A` })
    const b = definePlugin({ name: 'b', system: s => `${s}+B` })

    await run(createAgent({ model, system: 'S', plugins: [a, b] }), [user('go')])
    expect(prompt).toBe('S+A+B')
  })

  it('嵌套数组与拍平后的数组行为相同（承诺 1）', async () => {
    const orders: string[][] = []
    for (const shape of ['left', 'right'] as const) {
      const log: string[] = []
      const [a, b, c] = ['a', 'b', 'c'].map(n => definePlugin(tracer(n, log)))
      const plugins = shape === 'left' ? [[a, b], c] : [a, [b, c]]
      await run(createAgent({ model: fauxModel([callEcho('x'), fauxAssistantMessage('ok')]), tools: [echo], plugins }), [user('go')])
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

    const error = (() => {
      try {
        createAgent({ model, plugins: [p1, p2] })
      }
      catch (e) {
        return e
      }
    })()
    expect(error).toBeInstanceOf(PluginConflictError)
    expect((error as PluginConflictError).conflicts).toEqual({ tools: ['echo'], plugins: ['dup'] })
  })

  it('同一个对象登记多次不算冲突', () => {
    const p = definePlugin({ name: 'p', tools: [echo] })
    expect(() => createAgent({ model, tools: [echo], plugins: [p, p] })).not.toThrow()
  })
})

describe('插件状态', () => {
  const counter = definePlugin({
    name: 'counter',
    state: { init: 0, reduce: n => n + 1 },
  })

  it('reduce 在每步 update 之后运行，select 读取；未写入时返回 init', async () => {
    const model = fauxModel([callEcho('a'), callEcho('b'), fauxAssistantMessage('ok')])
    const state = await finalState(createAgent({ model, tools: [echo], plugins: [counter] }), [user('go')])

    expect(counter.select(state)).toBe(2)
    expect(counter.select({ messages: [], plugins: {} })).toBe(0)
  })

  it('热插拔：换插件列表后从同一个状态继续，新插件从 init 开始（承诺 4）', async () => {
    const first = await finalState(createAgent({ model: fauxModel([callEcho('a'), fauxAssistantMessage('ok')]), tools: [echo] }), [user('go')])
    const resumed: AgentState = { ...first, messages: [...first.messages, user('again')] }

    const model = fauxModel([callEcho('b'), fauxAssistantMessage('ok')])
    const second = await finalState(createAgent({ model, tools: [echo], plugins: [counter] }), resumed)

    expect(second.messages.slice(0, resumed.messages.length)).toEqual(resumed.messages)
    expect(counter.select(second)).toBe(1)
  })
})

describe('rewriteHistory', () => {
  it('policy 中间件返回 rewriteHistory：历史被替换，插件的 env / update / state 都不经过', async () => {
    let envCalls = 0
    let updateCalls = 0
    const compact = definePlugin({
      name: 'compact',
      async* policy(state, next) {
        if (state.messages.length >= 3) {
          return rewriteHistory([user('summary')])
        }
        return yield* next(state)
      },
      env: (msg, next) => {
        envCalls++
        return next(msg)
      },
      update: (s, msg, results, next) => {
        updateCalls++
        return next(s, msg, results)
      },
      state: { init: 0, reduce: n => n + 1 },
    })
    const model = fauxModel([callEcho('a'), (ctx) => {
      expect(ctx.messages.map(m => m.content)).toEqual(['summary'])
      return fauxAssistantMessage('ok')
    }])

    const rewrites: unknown[] = []
    let final: AgentState | undefined
    for await (const e of stream(createAgent({ model, tools: [echo], plugins: [compact] }), [user('go')])) {
      if (e.tag === 'act' && isHistoryRewrite(e.action)) {
        rewrites.push(e.obs)
      }
      if (e.tag === 'done') {
        final = e.state
      }
    }

    expect(rewrites).toEqual([[]])
    expect(final?.messages.map(m => m.role)).toEqual(['user'])
    expect([envCalls, updateCalls, compact.select(final!)]).toEqual([1, 1, 1])
  })
})
