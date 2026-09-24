import type { Api, Message, Model } from '@mariozechner/pi-ai'
import type { Plugin } from '@pi-rsi/llm'
import { completeSimple } from '@mariozechner/pi-ai'
import { definePlugin, rewriteHistory, textOf, user } from '@pi-rsi/llm'

export interface CompactionOptions {
  /** 写摘要用的模型。可以和主模型不同，用便宜的即可 */
  model: Model<Api>
  /** 上下文估算超过这么多 token 时压缩 */
  maxTokens: number
  /** 压缩时原样保留最近的多少条消息 */
  keepRecent?: number
}

export const SUMMARY_PREFIX = '[Summary of the earlier conversation]'

/**
 * 上下文压缩：历史太长时，让模型把较早的消息写成摘要，用「摘要 + 最近几条消息」替换历史。
 *
 * - 写摘要要调用模型，是 IO，所以放在 policy 里做
 * - 替换历史通过 rewriteHistory 交给 update，结果进入 AgentState，保存后恢复不需要重新摘要
 * - 被替换的消息不再发给模型，也不再留在状态里；需要完整记录时，在消费事件流时另存
 */
export function compaction({ model, maxTokens, keepRecent = 6 }: CompactionOptions): Plugin {
  return definePlugin({
    name: 'compaction',

    async* policy(state, next) {
      const { messages } = state
      const cut = cutIndex(messages, keepRecent)

      // 没超限，或者能压缩的消息太少（比如刚压缩过），就正常调用模型
      if (estimateTokens(messages) <= maxTokens || cut < 2) {
        return yield* next(state)
      }

      const summary = await summarize(model, messages.slice(0, cut))
      return rewriteHistory([user(`${SUMMARY_PREFIX}\n${summary}`), ...messages.slice(cut)])
    },
  })
}

/** 粗略估计：约 4 个字符 1 个 token。要更准可以改用上一个助手回合的 usage.input */
export function estimateTokens(messages: Message[]): number {
  return Math.ceil(JSON.stringify(messages).length / 4)
}

/**
 * 从哪里切开：保留最近 keepRecent 条。
 * 切点不能落在工具结果上，否则工具结果会和发起它的工具调用分开，provider 会拒绝请求；
 * 所以向前移到发起调用的助手消息。
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
    systemPrompt: 'Summarize the conversation below for an assistant that will continue it. '
      + 'Keep facts, decisions, open tasks, and the important results of tool calls. Be concise.',
    messages: [user(transcript(messages))],
  })

  if (reply.stopReason === 'error' || reply.stopReason === 'aborted') {
    throw new Error(`compaction: summary failed: ${reply.errorMessage}`)
  }
  return textOf(reply)
}

/** 把消息渲染成纯文本，交给摘要模型 */
function transcript(messages: Message[]): string {
  return messages.map((m) => {
    if (m.role === 'user') {
      const text = typeof m.content === 'string' ? m.content : m.content.flatMap(c => (c.type === 'text' ? [c.text] : [])).join('')
      return `User: ${text}`
    }
    if (m.role === 'assistant') {
      const calls = m.content.flatMap(c => (c.type === 'toolCall' ? [`-> ${c.name}(${JSON.stringify(c.arguments)})`] : []))
      return [`Assistant: ${textOf(m)}`, ...calls].join('\n')
    }

    const text = m.content.flatMap(c => (c.type === 'text' ? [c.text] : [])).join('')
    return `Tool ${m.toolName}${m.isError ? ' (error)' : ''}: ${text.slice(0, 2_000)}`
  }).join('\n\n')
}
