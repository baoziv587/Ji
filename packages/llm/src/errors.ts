import type { AgentState } from './types.ts'

/**
 * Why a run failed:
 *   aborted    r.abort() was called, or a reader left a `for await` early; `cause` is the abort reason
 *   max_steps  the run did not finish within the session's maxSteps
 *   provider   the model call failed (stopReason 'error' or 'aborted' from the provider)
 *   internal   anything else, such as a plugin hook throwing outside a tool call
 */
export type RunErrorKind = 'aborted' | 'max_steps' | 'provider' | 'internal'

/** What r.result, r.state, r.summary and every reader of a failed run reject with. */
export class RunError extends Error {
  readonly kind: RunErrorKind
  /** The step the run failed in. */
  readonly t: number
  /** The last committed state; resume from here with createSession(agent, { state }). */
  readonly state: AgentState

  constructor(kind: RunErrorKind, context: { t: number; state: AgentState; cause: unknown }) {
    super(messageOf(kind, context.cause), { cause: context.cause })
    this.name = 'RunError'
    this.kind = kind
    this.t = context.t
    this.state = context.state
  }
}

/** Thrown by the innermost model call, so the run can tell provider failures from the rest. */
export class ModelCallError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelCallError'
  }
}

function messageOf(kind: RunErrorKind, cause: unknown): string {
  const text = cause instanceof Error ? cause.message : cause === undefined ? '' : String(cause)
  if (kind === 'aborted') {
    return text === '' ? 'run aborted' : `run aborted: ${text}`
  }
  return text
}
