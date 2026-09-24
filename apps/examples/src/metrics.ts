// 记录耗时和费用：pnpm --filter @ji/examples metrics
//
// 不需要插件：Run 的每条记录带这一步的耗时和到目前为止的统计，r.summary 是整次运行的统计。
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { createAgent, createSession, tool, usageOf } from '@ji/llm'
import { fauxAssistantMessage, fauxText, fauxToolCall, Type } from '@mariozechner/pi-ai'
import { pickModel } from './shared.ts'

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

const chat = createSession(createAgent({ model, tools: [search] }))
const r = chat.send('帮我搜一下 pi-ai 和 agent kernel')

// 每一步：这一步的耗时，以及到目前为止的累计（可以直接显示在状态栏）
for await (const { t, turn, timing, summary } of r.turns) {
  if (turn.kind !== 'model') {
    continue
  }

  const tools = Object.values(timing.toolMs ?? {}).map(ms).join(', ')
  process.stdout.write(`[t=${t}] first token ${ms(timing.firstTokenMs)}, model ${ms(timing.modelMs)}`)
  console.log(`${tools ? `, tools ${tools}` : ''} · so far $${summary.usage.cost.toFixed(4)}, ${summary.usage.output} output tokens`)
}

// 整次运行
const { turns, usage, modelMs, toolMs, tools } = await r.summary
console.log(`\ntotal: ${turns} model turns, ${usage.input} in / ${usage.output} out tokens, $${usage.cost.toFixed(4)}`)
console.log(`model ${ms(modelMs)}, tools ${ms(toolMs)}:`, tools)

// 整段对话（跨多次运行）
console.log('session usage:', usageOf(chat.state))

function ms(value: number | undefined): string {
  return `${Math.round(value ?? 0)}ms`
}
