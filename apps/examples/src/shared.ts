import type { Run, RunSummary, Turn } from '@gaoxiang.ai/llm'
// 各示例共用：选模型、显示一次运行
import type { Api, FauxResponseStep, KnownProvider, Model } from '@mariozechner/pi-ai'
import process from 'node:process'
import { getModels, registerFauxProvider } from '@mariozechner/pi-ai'

/**
 * MODEL=anthropic/claude-sonnet-5 → 真实模型（API key 从环境变量读）
 * 不设 MODEL → pi-ai 的 faux provider，按 script 逐条回放，离线可跑
 */
export function pickModel(script: FauxResponseStep[], tokensPerSecond = 200): Model<Api> {
  const spec = process.env.MODEL
  if (spec) {
    const i = spec.indexOf('/')
    const [provider, id] = [spec.slice(0, i), spec.slice(i + 1)]
    const model = getModels(provider as KnownProvider).find(m => m.id === id)
    if (!model) {
      throw new Error(`unknown model: ${spec}`)
    }
    return model as Model<Api>
  }

  const faux = registerFauxProvider({ tokensPerSecond })
  faux.setResponses(script)
  return faux.getModel()
}

/** 同时读两个成员：文字边生成边输出；每一步结束时打印一行记录。结束后打印统计 */
export async function show(r: Run): Promise<RunSummary> {
  const text = (async () => {
    for await (const chunk of r.text) {
      process.stdout.write(chunk)
    }
  })()

  for await (const { t, turn } of r.turns) {
    const line = describe(turn)
    if (line !== undefined) {
      console.log(`\n  [t=${t}] ${line}`)
    }
  }
  await text

  const summary = await r.summary
  console.log(
    `\n  summary: ${summary.turns} model turns, ${summary.usage.input} in / ${summary.usage.output} out tokens, $${summary.usage.cost.toFixed(4)}`,
  )
  return summary
}

function describe(turn: Turn): string | undefined {
  if (turn.kind === 'input') {
    const label = turn.interrupted ? 'interrupt' : turn.idle ? 'user' : 'steer'
    return `${label} → ${turn.messages.map(m => JSON.stringify(m.content)).join(', ')}`
  }
  if (turn.kind === 'rewrite') {
    return `history rewritten → ${turn.messages.length} messages`
  }
  if (turn.results.length === 0) {
    return undefined
  }

  return turn.results
    .map(r => {
      const text = r.content.map(c => (c.type === 'text' ? c.text : '')).join('')
      const preview = text.length > 60 ? `${text.slice(0, 60)}… (${text.length} chars)` : text
      return `${r.toolName}${r.isError ? ' ✗' : ''} → ${JSON.stringify(preview)}`
    })
    .join('\n  ')
}
