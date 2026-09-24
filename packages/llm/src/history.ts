import type { Message } from '@mariozechner/pi-ai'
import type { Step } from '@pi-rsi/kernel'
import type { AgentAction, HistoryRewrite } from './types.ts'
import { act } from '@pi-rsi/kernel'

/**
 * 在 policy 中间件里返回它，用 messages 替换整个历史。
 * 生成新历史需要的 IO（例如调用模型写摘要）在 policy 里完成；替换本身由 update 完成，所以可以重放。
 */
export function rewriteHistory(messages: Message[]): Step<HistoryRewrite, never> {
  return act({ type: 'rewrite_history', messages })
}

export function isHistoryRewrite(action: AgentAction): action is HistoryRewrite {
  return 'type' in action && action.type === 'rewrite_history'
}
