import type { AssistantMessage, Message, ToolCall } from '@mariozechner/pi-ai'

export const user = (text: string): Message => ({ role: 'user', content: text, timestamp: Date.now() })

export const textOf = (m: AssistantMessage): string => m.content.flatMap(c => (c.type === 'text' ? [c.text] : [])).join('')

export const callsOf = (m: AssistantMessage): ToolCall[] => m.content.filter((c): c is ToolCall => c.type === 'toolCall')
