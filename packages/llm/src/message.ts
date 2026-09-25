import type { AssistantMessage, Message, ToolCall } from '@mariozechner/pi-ai'
import type { AgentState } from './types.ts'

export const user = (text: string): Message => ({
  role: 'user',
  content: text,
  timestamp: Date.now(),
})

export const textOf = (m: AssistantMessage): string =>
  m.content.flatMap(c => (c.type === 'text' ? [c.text] : [])).join('')

export const callsOf = (m: AssistantMessage): ToolCall[] =>
  m.content.filter((c): c is ToolCall => c.type === 'toolCall')

/** agent 空闲：历史为空，或最后一条是没有工具调用的助手消息 */
export function isIdle(state: AgentState): boolean {
  const last = state.messages.at(-1)
  if (last === undefined) {
    return true
  }

  return last.role === 'assistant' && callsOf(last).length === 0
}

export function lastAssistant(state: AgentState): AssistantMessage | undefined {
  return state.messages.findLast((m): m is AssistantMessage => m.role === 'assistant')
}
