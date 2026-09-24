import type { AssistantMessage } from '@mariozechner/pi-ai'
import type { AgentEvent, AgentState } from '@pi-rsi/llm'
import { performance } from 'node:perf_hooks'
import { definePlugin } from '@pi-rsi/llm'

/* ── 1. 插件：工具耗时 + token + 费用，随 AgentState 保存 ─────────── */

export interface Metrics {
  /** 调用了工具的模型回合数 */
  turns: number
  inputTokens: number
  outputTokens: number
  /** 美元，来自 provider 的计价 */
  cost: number
  toolCalls: number
  /** 各次工具调用耗时之和。并行调用会重叠，所以可能大于实际经过的时间 */
  toolMs: number
}

/**
 * 记录工具耗时和模型费用，分两处完成：
 *
 * - tool 中间件测量每次工具调用的耗时，写进 result.details.durationMs。读时钟是 IO，只能在执行工具时做
 * - state.reduce 把 token、费用、工具耗时累加进插件状态。它是纯函数，结果随 AgentState 保存和恢复
 *
 * 最后一个回合（直接给出答案、不再调用工具）不经过 update，它的用量在 done 事件的 result 上，
 * 用 withFinalTurn 补上。
 */
export const metrics = definePlugin<Metrics>({
  name: 'metrics',

  tool: async (ctx, next) => {
    const start = performance.now()
    const result = await next(ctx)
    return { ...result, details: { ...result.details, durationMs: performance.now() - start } }
  },

  state: {
    init: { turns: 0, inputTokens: 0, outputTokens: 0, cost: 0, toolCalls: 0, toolMs: 0 },
    reduce: (m, msg, results) => ({
      ...addTurn(m, msg),
      toolCalls: m.toolCalls + results.length,
      toolMs: m.toolMs + results.reduce((ms, r) => ms + (r.details?.durationMs ?? 0), 0),
    }),
  },
})

export function withFinalTurn(state: AgentState, final: AssistantMessage): Metrics {
  return addTurn(metrics.select(state), final)
}

function addTurn(m: Metrics, msg: AssistantMessage): Metrics {
  return {
    ...m,
    turns: m.turns + 1,
    inputTokens: m.inputTokens + msg.usage.input + msg.usage.cacheRead,
    outputTokens: m.outputTokens + msg.usage.output,
    cost: m.cost + msg.usage.cost.total,
  }
}

/* ── 2. 事件流观察：每一步模型和工具各花了多久 ─────────────────── */

export interface StepTiming {
  t: number
  /** 从这一步开始到收到第一段内容（文字、思考或工具参数） */
  firstTokenMs: number
  /** 从这一步开始到模型输出结束 */
  modelMs: number
  /** 模型输出结束到工具全部执行完；没有工具时为 0 */
  toolsMs: number
}

/**
 * 原样转发事件，同时测量每一步的耗时，交给 report。
 * 只观察、不改变行为（I10），所以写成事件流的包装，而不是插件。
 */
export async function* withStepTimings(
  events: AsyncIterable<AgentEvent>,
  report: (timing: StepTiming) => void,
): AsyncGenerator<AgentEvent, void> {
  let stepStart = performance.now()
  let firstToken: number | undefined
  let modelEnd = stepStart

  for await (const e of events) {
    const now = performance.now()

    if (e.tag === 'delta') {
      if (e.delta.type.endsWith('_delta')) {
        firstToken ??= now
      }
      modelEnd = now
    }
    else {
      const toolsMs = e.tag === 'act' ? now - modelEnd : 0
      report({ t: e.t, firstTokenMs: (firstToken ?? modelEnd) - stepStart, modelMs: modelEnd - stepStart, toolsMs })

      stepStart = now
      firstToken = undefined
      modelEnd = now
    }

    yield e
  }
}
