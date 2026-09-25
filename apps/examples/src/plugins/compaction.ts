import type { Plugin } from '@gaoxiang.ai/llm'
import type { Api, Message, Model } from '@mariozechner/pi-ai'
import { definePlugin, rewriteHistory, textOf, user } from '@gaoxiang.ai/llm'
import { completeSimple } from '@mariozechner/pi-ai'

export interface CompactionOptions {
  /** Model that writes the summary. It can differ from the main model; a cheap one is fine. */
  model: Model<Api>
  /** Compact once the estimated context exceeds this many tokens. */
  maxTokens: number
  /** How many recent messages to keep verbatim when compacting. */
  keepRecent?: number
}

export const SUMMARY_PREFIX = '[Summary of the earlier conversation]'

/**
 * Context compaction: when the history grows too long, the model summarizes the older messages and the history
 * becomes "summary + the last few messages".
 *
 * - Writing the summary calls a model, which is IO, so it happens in policy.
 * - The replacement goes through update via rewriteHistory, so it lands in AgentState and a restored session
 *   does not need to summarize again.
 * - Replaced messages are neither sent to the model nor kept in state. For the full record, read the state
 *   of the step before the rewrite from r.turns.
 */
export function compaction({ model, maxTokens, keepRecent = 6 }: CompactionOptions): Plugin {
  return definePlugin({
    name: 'compaction',

    async *policy(state, next) {
      const { messages } = state
      const cut = cutIndex(messages, keepRecent)

      // Under the limit, or too few messages to be worth summarizing (e.g. right after a compaction)
      if (estimateTokens(messages) <= maxTokens || cut < 2) {
        return yield* next(state)
      }

      const summary = await summarize(model, messages.slice(0, cut))
      return rewriteHistory([user(`${SUMMARY_PREFIX}\n${summary}`), ...messages.slice(cut)])
    },
  })
}

/** Rough estimate of ~4 characters per token. For accuracy, use usage.input from the last assistant turn. */
function estimateTokens(messages: Message[]): number {
  return Math.ceil(JSON.stringify(messages).length / 4)
}

/**
 * Keeps the last keepRecent messages, but the kept part must not start on a tool result: providers reject a
 * tool result separated from the call that produced it, so the cut steps back to the assistant message that
 * made the calls.
 *
 *   index 0     1     2       3     4       5       6
 *   msgs  user  asst  result  asst  result  result  asst    keepRecent = 3
 *                             ^     ^
 *                             |     +-- length - keepRecent = 4 is a toolResult
 *                             +-------- step back past toolResults -> cut = 3
 *
 *   [0, cut) -> summarized        [cut, end) -> kept verbatim
 */
export function cutIndex(messages: Message[], keepRecent: number): number {
  let cut = Math.max(0, messages.length - keepRecent)
  while (cut > 0 && messages[cut].role === 'toolResult') {
    cut--
  }
  return cut
}

async function summarize(model: Model<Api>, messages: Message[]): Promise<string> {
  const reply = await completeSimple(model, {
    systemPrompt:
      'Summarize the conversation below for an assistant that will continue it. ' +
      'Keep facts, decisions, open tasks, and the important results of tool calls. Be concise.',
    messages: [user(transcript(messages))],
  })

  if (reply.stopReason === 'error' || reply.stopReason === 'aborted') {
    throw new Error(`compaction: summary failed: ${reply.errorMessage}`)
  }
  return textOf(reply)
}

function transcript(messages: Message[]): string {
  return messages
    .map(m => {
      if (m.role === 'user') {
        const text =
          typeof m.content === 'string'
            ? m.content
            : m.content.flatMap(c => (c.type === 'text' ? [c.text] : [])).join('')
        return `User: ${text}`
      }
      if (m.role === 'assistant') {
        const calls = m.content.flatMap(c =>
          c.type === 'toolCall' ? [`-> ${c.name}(${JSON.stringify(c.arguments)})`] : [],
        )
        return [`Assistant: ${textOf(m)}`, ...calls].join('\n')
      }

      const text = m.content.flatMap(c => (c.type === 'text' ? [c.text] : [])).join('')
      return `Tool ${m.toolName}${m.isError ? ' (error)' : ''}: ${text.slice(0, 2_000)}`
    })
    .join('\n\n')
}
