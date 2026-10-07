import type { JsonValue, ToolCall, ToolResultMessage, TSchema } from '@earendil-works/pi-ai/compat'
import type { AgentTool, ToolRunner } from './types.ts'
import { validateToolCall } from '@earendil-works/pi-ai/compat'
import { mapYield } from '@ji.dev/kernel'
import { errorMessage, isAsyncIterable } from '@ji.dev/utils'

/** Identity; exists so `run`'s arguments are inferred from the schema. */
export const tool = <T extends TSchema>(t: AgentTool<T>): AgentTool<T> => t

export function toolResult(call: ToolCall, text: string): ToolResultMessage {
  return resultOf(call, text, false)
}

/**
 * Return this to intercept, deny or report an expected failure to the model. It is a result, not an exception: a
 * retry's catch never sees it (RFC-0006 §4.2).
 */
export function toolError(call: ToolCall, error: unknown): ToolResultMessage {
  return resultOf(call, errorMessage(error), true)
}

/**
 * The innermost tool runner; every tool gets the step's signal. A tool whose `run` is an async generator streams each
 * yielded value as a tool_update; its return value is the result. Rethrows instead of converting to toolError so outer
 * toolCall middleware (retry) can see the failure.
 */
export function toolRunner(tools: AgentTool[], signal: AbortSignal): ToolRunner {
  const byName = new Map(tools.map(t => [t.name, t]))

  return async function* (call) {
    const args = validateToolCall(tools, call)
    const output = byName.get(call.name)!.run(args, signal)
    const done = isAsyncIterable(output)
      ? yield* mapYield(output, data => ({ type: 'tool_update', call, data }) as const)
      : await output
    return typeof done === 'object' && done !== null
      ? resultOf(call, done.text, done.isError ?? false, done.details)
      : toolResult(call, String(done))
  }
}

function resultOf(call: ToolCall, text: string, isError: boolean, details?: JsonValue): ToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId: call.id,
    toolName: call.name,
    content: [{ type: 'text', text }],
    ...(details === undefined ? {} : { details }),
    isError,
    timestamp: Date.now(),
  }
}
