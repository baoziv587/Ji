import type { AgentState, Plugin } from '@pi-rsi/llm'
import { definePlugin, user } from '@pi-rsi/llm'

export interface KeepGoingOptions {
  /** 任务是否完成。完成后不再自动继续 */
  isDone: (state: AgentState) => boolean
  /** 最多自动继续几次 */
  maxTimes?: number
  prompt?: string
}

/**
 * 自动继续：agent 空闲、没有用户消息要处理、任务又没完成时，插入一条「继续」。
 *
 * 用 input 钩子：它在每个步边界拿到此刻可以送达的用户消息，返回要插入的消息。
 * 已经自动继续了几次记在插件状态里，随状态保存。
 */
export function keepGoing({ isDone, maxTimes = 3, prompt = 'Keep going until the task is done.' }: KeepGoingOptions): Plugin<number> {
  const plugin: Plugin<number> = definePlugin({
    name: 'keep-going',

    input: (messages, { state, idle }) => {
      if (!idle || messages.length > 0) {
        return messages
      }
      if (isDone(state) || plugin.select(state) >= maxTimes) {
        return messages
      }

      return [user(prompt)]
    },

    state: {
      init: 0,
      reduce: (n, turn) => (turn.kind === 'input' && turn.messages.some(m => m.content === prompt) ? n + 1 : n),
    },
  })

  return plugin
}
