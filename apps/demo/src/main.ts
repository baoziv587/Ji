// demo
//   pnpm demo                                    离线：pi-ai 自带的 faux provider（逐 token 流式）
//   MODEL=anthropic/claude-sonnet-4-6 pnpm demo   真实：pi-ai 支持的任意 provider/模型，API key 从环境变量读
import type { Api, KnownProvider, Message, Model } from '@mariozechner/pi-ai'
import process from 'node:process'
import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  getModels,
  registerFauxProvider,
  Type,
} from '@mariozechner/pi-ai'
import { mapState, unfold } from '@pi-rsi/kernel'
import { llmAgent, textOf, tool, user } from '@pi-rsi/llm'

const calc = tool({
  name: 'calc',
  description: 'Evaluate an arithmetic expression, e.g. "2*(3+4)".',
  parameters: Type.Object({ expr: Type.String() }),
  run: ({ expr }) => { // expr: string —— 从 schema 推断
    if (!/^[\d\s+\-*/().]+$/.test(expr))
      throw new Error(`bad expr: ${expr}`)
    // eslint-disable-next-line no-new-func -- expr 已被上面的白名单正则限制为纯算术
    return String(new Function(`return (${expr})`)())
  },
})

function pickModel(): Model<Api> {
  const spec = process.env.MODEL
  if (spec) {
    const i = spec.indexOf('/')
    const [provider, id] = [spec.slice(0, i), spec.slice(i + 1)]
    const m = getModels(provider as KnownProvider).find(m => m.id === id)
    if (!m)
      throw new Error(`unknown model: ${spec}`)
    return m as Model<Api>
  }
  const faux = registerFauxProvider({ tokensPerSecond: 80 })
  faux.setResponses([
    fauxAssistantMessage([fauxText('先算乘法。'), fauxToolCall('calc', { expr: '17*23' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage([fauxText('故意漏掉参数。'), fauxToolCall('calc', {})], { stopReason: 'toolUse' }),
    fauxAssistantMessage([fauxText('再加 9。'), fauxToolCall('calc', { expr: '391+9' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage('17×23 = 391，再加 9 得 400。'),
  ])
  return faux.getModel()
}

const keepLast = (n: number) => (s: Message[]) => (s.length > n ? [s[0], ...s.slice(-(n - 1))] : s)
const agent = mapState(llmAgent(pickModel(), [calc], { systemPrompt: 'Use the calc tool for arithmetic.' }), keepLast(20))

for await (const e of unfold(agent, [user('算 17*23，然后结果加 9。')])) {
  if (e.tag === 'delta') {
    if (e.delta.type === 'text_delta')
      process.stdout.write(e.delta.delta)
  }
  else if (e.tag === 'act') {
    console.log(`\n  [t=${e.t}] tools →`, JSON.stringify(e.obs.map(r => (r.isError ? '✗ ' : '') + r.content.map(c => c.type === 'text' ? c.text : '').join(''))))
  }
  else {
    console.log(`\n  [t=${e.t}] done: "${textOf(e.result)}"  (|S| = ${e.state.length}, tokens = ${e.result.usage.totalTokens})`)
  }
}
