import { definePlugin, rewriteHistory, textOf, user } from '@ji.dev/llm'
import { cutIndex, estimateTokens } from '@ji.dev/plugin-compaction'
import { transcript } from './context.ts'
// @snippet
const compactHistory = definePlugin({
  name: 'compaction',
  async *decide(state, next, { complete }) {
    const { messages } = state
    const cut = cutIndex(messages, 6)

    if (estimateTokens(messages) <= 100_000 || cut < 2) return yield* next(state)

    const summary = yield* complete({
      systemPrompt: 'Summarize facts, decisions, open tasks and important tool results.',
      messages: [user(transcript(messages.slice(0, cut)))],
    })

    return rewriteHistory([user(textOf(summary)), ...messages.slice(cut)])
  },
})
