import type { Api, AssistantMessage, Message, Model, Plugin } from '@gaoxiang.ai/llm'
import { definePlugin, rewriteHistory, textOf, user } from '@gaoxiang.ai/llm'

declare module '@gaoxiang.ai/llm' {
  interface Events {
    'compaction:start': { tokens: number }
    /** `after` equals `before` when the summary ran out of time and the history was kept as it was. */
    'compaction:end': { before: number; after: number }
  }
}

export interface CompactionOptions {
  /** Compact once the estimated context exceeds this many tokens. */
  maxTokens: number
  /** How many recent messages to keep verbatim when compacting. */
  keepRecent?: number
  /** Model that writes the summary. Default: the agent's; a cheaper one is fine. */
  model?: Model<Api>
  /** Give up on the summary after this many ms and keep the long history for this step. Default: no limit. */
  timeoutMs?: number
}

export const SUMMARY_PREFIX = '[Summary of the earlier conversation]'

const SUMMARIZE =
  'Summarize the conversation below for an assistant that will continue it. ' +
  'Keep facts, decisions, open tasks, and the important results of tool calls. Be concise.'

/**
 * Context compaction: when the history grows too long, the model summarizes the older messages and the history
 * becomes "summary + the last few messages".
 *
 * - The summary comes from ctx.complete: it goes through the agent's request plugins (fallback and the like), is
 *   cancelled with the step, shows up as model events with `by: 'compaction'`, and counts in r.summary.usage.
 * - The replacement goes through record via rewriteHistory, so it lands in AgentState and a restored session
 *   does not need to summarize again.
 * - Replaced messages are neither sent to the model nor kept in state. For the full record, read the state
 *   of the step before the rewrite from r.turns.
 */
export function compaction({ maxTokens, keepRecent = 6, model, timeoutMs }: CompactionOptions): Plugin {
  return definePlugin({
    name: 'compaction',

    async *turn(state, next, { complete, signal }) {
      const { messages } = state
      const cut = cutIndex(messages, keepRecent)
      const before = estimateTokens(messages)

      // Under the limit, or too few messages to be worth summarizing (e.g. right after a compaction)
      if (before <= maxTokens || cut < 2) {
        return yield* next(state)
      }

      yield { type: 'compaction:start', tokens: before }

      const deadline = timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs)
      const request = { model, systemPrompt: SUMMARIZE, messages: [user(transcript(messages.slice(0, cut)))] }
      let reply: AssistantMessage
      try {
        reply = yield* complete(request, { signal: deadline })
      } catch (error) {
        // Only running out of our own time is ours to handle; a cancelled step or a failing model goes up as usual
        if (signal.aborted || deadline?.aborted !== true) {
          throw error
        }

        yield { type: 'compaction:end', before, after: before }
        return yield* next(state)
      }

      const compacted = [user(`${SUMMARY_PREFIX}\n${textOf(reply)}`), ...messages.slice(cut)]
      yield { type: 'compaction:end', before, after: estimateTokens(compacted) }
      return rewriteHistory(compacted)
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
