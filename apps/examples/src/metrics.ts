// 记录耗时和费用：pnpm --filter @pi-rsi/examples metrics
//
// - 每步模型 / 工具耗时：用 withStepTimings 包装事件流（只观察）
// - 每次工具调用耗时、累计 token 和费用：metrics 插件，结果存在 AgentState 里
import { setTimeout as sleep } from 'node:timers/promises'
import { fauxAssistantMessage, fauxText, fauxToolCall, Type } from '@mariozechner/pi-ai'
import { createAgent, stream, tool, user } from '@pi-rsi/llm'
import { metrics, withFinalTurn, withStepTimings } from './plugins/metrics.ts'
import { pickModel, print } from './shared.ts'

const search = tool({
  name: 'search',
  description: 'Search the web.',
  parameters: Type.Object({ query: Type.String() }),
  run: async ({ query }, signal) => {
    await sleep(300, undefined, { signal })
    return `3 results for "${query}"`
  },
})

const model = pickModel([
  fauxAssistantMessage([fauxText('查两个关键词。'), fauxToolCall('search', { query: 'pi-ai' }), fauxToolCall('search', { query: 'agent kernel' })], { stopReason: 'toolUse' }),
  fauxAssistantMessage('两个关键词各有 3 条结果。'),
])

const agent = createAgent({ model, tools: [search], plugins: [metrics] })
const events = withStepTimings(stream(agent, [user('帮我搜一下 pi-ai 和 agent kernel')]), (timing) => {
  console.log(`\n  [t=${timing.t}] first token ${ms(timing.firstTokenMs)}, model ${ms(timing.modelMs)}, tools ${ms(timing.toolsMs)}`)
})

for await (const e of events) {
  print(e)

  if (e.tag === 'act') {
    for (const r of e.obs) {
      console.log(`  ${r.toolName} took ${ms(r.details?.durationMs)}`)
    }
  }

  if (e.tag === 'done') {
    const total = withFinalTurn(e.state, e.result)
    console.log(`\n  total: ${total.turns} turns, ${total.inputTokens} in / ${total.outputTokens} out tokens, $${total.cost.toFixed(4)}, ${total.toolCalls} tool calls totalling ${ms(total.toolMs)}`)
  }
}

function ms(value: number | undefined): string {
  return `${Math.round(value ?? 0)}ms`
}
