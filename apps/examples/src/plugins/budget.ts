import type { Plugin } from '@gaoxiang.ai/llm'
import { definePlugin, intercept, stop, usageOf } from '@gaoxiang.ai/llm'

export interface BudgetOptions {
  /** In US dollars. */
  maxCost?: number
  /** Input + output tokens. */
  maxTokens?: number
}

/**
 * Ends the run before the next step once cumulative usage reaches a limit.
 *
 * usageOf(state) sums the usage of the main model's messages still in the history; stop(state) finishes with the last
 * assistant message as the result. `intercept` returns stop(...) to end here, or undefined to let the step go on.
 *
 * Not a hard cap on spending: plugin model calls (ctx.complete) and messages dropped by a history rewrite are not in
 * the history, so they do not count here, although r.summary.usage includes them.
 */
export function budget({ maxCost = Infinity, maxTokens = Infinity }: BudgetOptions): Plugin {
  return definePlugin({
    name: 'budget',

    decide: intercept(state => {
      const { input, output, cost } = usageOf(state)
      return cost >= maxCost || input + output >= maxTokens ? stop(state) : undefined
    }),
  })
}
