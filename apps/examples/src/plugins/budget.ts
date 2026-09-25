import type { Plugin } from '@gaoxiang.ai/llm'
import { definePlugin, stop, usageOf } from '@gaoxiang.ai/llm'

export interface BudgetOptions {
  /** In US dollars. */
  maxCost?: number
  /** Input + output tokens. */
  maxTokens?: number
}

/**
 * Ends the run before the next step once cumulative usage reaches a limit.
 *
 * usageOf(state) sums the usage of every assistant message in the history;
 * stop(state) finishes with the last assistant message as the result.
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
