// Timing and cost: pnpm --filter @ji.dev/examples metrics
//
// No plugin needed: every record of a Run carries that step's timing and the totals so far,
// and r.summary holds the totals for the whole run.
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { createAgent, createSession, tool, Type, usageOf } from '@ji.dev/llm'
import { assistantMessage, textBlock, toolUse } from '@ji.dev/testing'
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
  assistantMessage([
    textBlock('Searching both terms.'),
    toolUse('search', { query: 'pi-ai' }),
    toolUse('search', { query: 'agent kernel' }),
  ]),
  assistantMessage('Each term has 3 results.'),
])

const chat = createSession(createAgent({ model, tools: [search] }))
const r = chat.send('Search for pi-ai and agent kernel')

// The running totals on each record are what a status bar would show
for await (const { t, turn, timing, summary } of r.turns) {
  if (turn.kind !== 'model') {
    continue
  }

  const tools = Object.values(timing.toolMs ?? {})
    .map(ms)
    .join(', ')
  process.stdout.write(`[t=${t}] first token ${ms(timing.firstTokenMs)}, model ${ms(timing.modelMs)}`)
  console.log(
    `${tools ? `, tools ${tools}` : ''} · so far $${summary.usage.cost.toFixed(4)}, ${summary.usage.output} output tokens`,
  )
}

const { turns, usage, modelMs, toolMs, tools } = await r.summary
console.log(`\ntotal: ${turns} model turns, ${usage.input} in / ${usage.output} out tokens, $${usage.cost.toFixed(4)}`)
console.log(`model ${ms(modelMs)}, tools ${ms(toolMs)}:`, tools)

// usageOf(state) covers the whole conversation, across runs
console.log('session usage:', usageOf(chat.state))

function ms(value: number | undefined): string {
  return `${Math.round(value ?? 0)}ms`
}
