import type { ToolCall, ToolResultMessage, TSchema } from '@mariozechner/pi-ai'
import type { AgentTool, ToolRunner } from './types.ts'
import { validateToolCall } from '@mariozechner/pi-ai'

/** 只为让 run 的参数从 schema 推断出类型 */
export const tool = <T extends TSchema>(t: AgentTool<T>): AgentTool<T> => t

export function toolResult(call: ToolCall, text: string): ToolResultMessage {
  return resultOf(call, text, false)
}

/** 拦截、拒绝或失败时返回给模型的结果；不要抛错（I8） */
export function toolError(call: ToolCall, error: unknown): ToolResultMessage {
  const text = error instanceof Error ? error.message : String(error)
  return resultOf(call, text, true)
}

/** 基础 runner：按 schema 校验参数并执行。异常原样抛出，外层中间件（重试、超时）能看到 */
export function toolRunner(tools: AgentTool[]): ToolRunner {
  const byName = new Map(tools.map(t => [t.name, t]))

  return async ({ call, signal }) => {
    const args = validateToolCall(tools, call)
    const text = await byName.get(call.name)!.run(args, signal)
    return toolResult(call, String(text))
  }
}

function resultOf(call: ToolCall, text: string, isError: boolean): ToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId: call.id,
    toolName: call.name,
    content: [{ type: 'text', text }],
    isError,
    timestamp: Date.now(),
  }
}
