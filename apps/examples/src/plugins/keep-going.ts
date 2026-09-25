import type { AgentState, Plugin } from '@gaoxiang.ai/llm'
import { definePlugin, user } from '@gaoxiang.ai/llm'

export interface KeepGoingOptions {
  /** Once this returns true, the plugin stops nudging. */
  isDone: (state: AgentState) => boolean
  /** Maximum number of automatic nudges. */
  maxTimes?: number
  prompt?: string
}

/**
 * Inserts a "keep going" message when the agent is idle, no user message is waiting, and the task is not done.
 *
 * Uses the input hook, which receives the user messages deliverable at each step boundary and returns
 * the ones to insert. The nudge count lives in plugin state, so it is saved along with the session.
 */
export function keepGoing({
  isDone,
  maxTimes = 3,
  prompt = 'Keep going until the task is done.',
}: KeepGoingOptions): Plugin<number> {
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
