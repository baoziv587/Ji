import type { Plugin, ToolResultMessage } from '@ji.dev/llm'
import { callsOf, definePlugin } from '@ji.dev/llm'

/**
 * Runs the tool calls of a turn one at a time instead of all at once, e.g. for tools that write the same files.
 *
 * Only toolCalls can do this. By the time toolCall runs, the calls of the turn have already been started together;
 * each toolCall sees its own call and nothing of the others. toolCalls wraps the whole batch, so it hands the calls
 * to next one by one: a message holding a single call is a batch of one.
 *
 *   toolCalls(message)                     <- sees every call of the turn: can reorder, split or refuse the batch
 *     next({ ...message, content: [a] })   -> toolCall(a) runs alone
 *     next({ ...message, content: [b] })   -> then toolCall(b)
 *
 * Only the tools run this way; the history still records the model's message as it was, with every call in it.
 */
export function sequentialTools(): Plugin {
  return definePlugin({
    name: 'sequential-tools',

    async *toolCalls(message, next) {
      const results: ToolResultMessage[] = []
      for (const call of callsOf(message)) {
        results.push(...(yield* next({ ...message, content: [call] })))
      }
      return results
    },
  })
}
