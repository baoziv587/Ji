import type { Stream } from '@gaoxiang.ai/kernel'
import type { ToolCall, ToolResultMessage, TSchema } from '@mariozechner/pi-ai'
import type { AgentTool, ToolRunner } from './types.ts'
import { mapYield } from '@gaoxiang.ai/kernel'
import { validateToolCall } from '@mariozechner/pi-ai'

/** Identity; exists so `run`'s arguments are inferred from the schema. */
export const tool = <T extends TSchema>(t: AgentTool<T>): AgentTool<T> => t

export function toolResult(call: ToolCall, text: string): ToolResultMessage {
  return resultOf(call, text, false)
}

/** Return this to intercept, deny or report failure to the model instead of throwing (I8). */
export function toolError(call: ToolCall, error: unknown): ToolResultMessage {
  const text = error instanceof Error ? error.message : String(error)
  return resultOf(call, text, true)
}

/**
 * The innermost tool runner. A tool whose `run` is an async generator streams each yielded value as a tool_update;
 * its return value is the result. Rethrows instead of converting to toolError so outer tool middleware (retry,
 * timeout) can see the failure.
 */
export function toolRunner(tools: AgentTool[]): ToolRunner {
  const byName = new Map(tools.map(t => [t.name, t]))

  return async function* ({ call, signal }) {
    const args = validateToolCall(tools, call)
    const output = byName.get(call.name)!.run(args, signal)
    const text = isStream(output)
      ? yield* mapYield(output, data => ({ type: 'tool_update', call, data }) as const)
      : await output
    return toolResult(call, String(text))
  }
}

function isStream(output: unknown): output is Stream<unknown, string> {
  return typeof output === 'object' && output !== null && Symbol.asyncIterator in output
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
