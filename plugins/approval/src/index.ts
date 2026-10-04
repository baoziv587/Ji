// @ji.dev/plugin-approval: asks a person before a tool call runs
//
//   createAgent({ model, plugins: [fileTools, approval({ ask, previews: [fileTools.preview, named('bash')] })] })
//
//   Preview   what a call is about to do, before it runs. It is `intercept` with one more answer:
//               undefined            nothing to approve: the call runs, or the next preview looks at it
//               a tool result        the call ends with it, and nobody is asked
//               a Proposal           a person is asked
//   ask       shows a proposal to a person: true lets the call run, false or a string refuses it
//
// A Preview is a plain function over ToolCall and ToolResultMessage, so a plugin offers one without importing this
// package (RFC-0005 §8.3): the plugin that owns a tool knows best what a call of it will do.

import type { Plugin, ToolCall, ToolResultMessage } from '@ji.dev/llm'
import { definePlugin, toolError } from '@ji.dev/llm'

export interface Proposal {
  /** One line: what the call is about to do. */
  title: string
  /** The rest of what a person needs to decide: a diff, a command. */
  detail?: string
  /**
   * The call to run once approved, for a preview that fixes what it showed on the call, so that what runs is what was
   * approved. Left out, the previewed call runs as it is.
   */
  call?: ToolCall
}

export type Preview = (
  call: ToolCall,
  signal: AbortSignal,
) => Proposal | ToolResultMessage | undefined | Promise<Proposal | ToolResultMessage | undefined>

/** What a person is asked: a proposal, with the call that runs if they approve. */
export interface Question extends Proposal {
  call: ToolCall
}

/** true approves. false refuses; a string refuses and is what the model is told, so it can carry what to do instead. */
export type Ask = (question: Question, signal: AbortSignal) => boolean | string | Promise<boolean | string>

export interface ApprovalOptions {
  ask: Ask
  /**
   * Tried in order; the first that returns anything decides, and a call none of them knows runs unasked.
   * Default: [everyCall], so every call is asked about.
   */
  previews?: readonly Preview[]
}

const REJECTED = 'The user rejected this call.'

/** Every call, shown as its name and arguments. */
export const everyCall: Preview = call => ({
  title: `Run ${call.name}`,
  detail: JSON.stringify(call.arguments, null, 2),
})

/** The calls of these tools, shown like everyCall: for tools whose plugin has no preview of its own. */
export function named(...names: string[]): Preview {
  return (call, signal) => (names.includes(call.name) ? everyCall(call, signal) : undefined)
}

/**
 * Questions are asked one at a time, in the order their calls arrive: calls of one turn run at once, but a person
 * answers one question at a time. A refused call never runs; the model gets the refusal as the call's result.
 */
export function approval({ ask, previews = [everyCall] }: ApprovalOptions): Plugin {
  let asking: Promise<unknown> = Promise.resolve()

  return definePlugin({
    name: 'approval',
    async *toolCall(call, next, { signal }) {
      const preview = await firstOf(previews, call, signal)
      signal.throwIfAborted()

      if (preview === undefined) {
        return yield* next(call)
      }
      if (isResult(preview)) {
        return preview
      }

      const question = { ...preview, call: preview.call ?? call }
      const answer = asking.then(() => {
        signal.throwIfAborted()
        return ask(question, signal)
      })
      asking = answer.catch(() => {})
      const approved = await answer
      signal.throwIfAborted()

      return approved === true ? yield* next(question.call) : toolError(call, approved || REJECTED)
    },
  })
}

async function firstOf(
  previews: readonly Preview[],
  call: ToolCall,
  signal: AbortSignal,
): Promise<Proposal | ToolResultMessage | undefined> {
  for (const preview of previews) {
    const found = await preview(call, signal)
    if (found !== undefined) {
      return found
    }
  }
  return undefined
}

function isResult(preview: Proposal | ToolResultMessage): preview is ToolResultMessage {
  return 'role' in preview
}
