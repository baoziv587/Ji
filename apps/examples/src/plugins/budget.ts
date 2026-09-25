import type { Plugin } from '@gaoxiang.ai/llm'
import { definePlugin, stop, usageOf } from '@gaoxiang.ai/llm'

export interface BudgetOptions {
  /** 美元 */
  maxCost?: number
  /** 输入 + 输出 token */
  maxTokens?: number
}

/**
 * 预算：累计用量超过上限时，在下一步开始前结束运行。
 *
 * 用量用 usageOf(state) 读取，它把历史中所有助手消息的用量加起来。
 * stop(state) 以最后一条助手消息作为结果结束。
 */
export function budget({ maxCost = Infinity, maxTokens = Infinity }: BudgetOptions): Plugin {
  return definePlugin({
    name: 'budget',

    async *policy(state, next) {
      const { input, output, cost } = usageOf(state)
      if (cost >= maxCost || input + output >= maxTokens) {
        return stop(state)
      }

      return yield* next(state)
    },
  })
}
