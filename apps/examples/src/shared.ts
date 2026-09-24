// 各示例共用：选模型、打印事件
import type { Api, FauxResponseStep, KnownProvider, Model } from '@mariozechner/pi-ai'
import type { AgentEvent } from '@pi-rsi/llm'
import process from 'node:process'
import { getModels, registerFauxProvider } from '@mariozechner/pi-ai'
import { isHistoryRewrite, textOf } from '@pi-rsi/llm'

/**
 * MODEL=anthropic/claude-sonnet-5 → 真实模型（API key 从环境变量读）
 * 不设 MODEL → pi-ai 的 faux provider，按 script 逐条回放，离线可跑
 */
export function pickModel(script: FauxResponseStep[]): Model<Api> {
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

  const faux = registerFauxProvider({ tokensPerSecond: 200 })
  faux.setResponses(script)
  return faux.getModel()
}

/** 模型文字直接输出；工具结果、历史替换、结束各打印一行 */
export function print(e: AgentEvent): void {
  if (e.tag === 'delta') {
    if (e.delta.type === 'text_delta') {
      process.stdout.write(e.delta.delta)
    }
    return
  }

  if (e.tag === 'done') {
    console.log(`\n  [t=${e.t}] done: "${textOf(e.result)}"`)
    return
  }

  if (isHistoryRewrite(e.action)) {
    console.log(`\n  [t=${e.t}] history rewritten → ${e.state.messages.length} messages`)
    return
  }

  for (const r of e.obs) {
    const text = r.content.map(c => (c.type === 'text' ? c.text : '')).join('')
    const preview = text.length > 60 ? `${text.slice(0, 60)}… (${text.length} chars)` : text
    console.log(`\n  [t=${e.t}] ${r.toolName}${r.isError ? ' ✗' : ''} → ${JSON.stringify(preview)}`)
  }
}
