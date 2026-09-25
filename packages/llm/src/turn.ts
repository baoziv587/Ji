import type { Step } from '@gaoxiang.ai/kernel'
import type { AssistantMessage, Message, ToolResultMessage } from '@mariozechner/pi-ai'
import type { AgentAction, AgentState, RewriteAction, Turn } from './types.ts'
import { act, done } from '@gaoxiang.ai/kernel'
import { lastAssistant } from './message.ts'

/**
 * Return from a policy middleware to replace the whole history with `messages`.
 * Do any IO needed to build them (e.g. a summarizing model call) in the policy; the replacement itself happens in
 * update, so it stays replayable.
 */
export function rewriteHistory(messages: Message[]): Step<RewriteAction, never> {
  return act({ kind: 'rewrite', messages })
}

/** Return from a policy middleware to end the run with the last assistant message as its result. */
export function stop(state: AgentState): Step<never, AssistantMessage> {
  const last = lastAssistant(state)
  if (last === undefined) {
    throw new Error('stop: no assistant message to return')
  }

  return done(last)
}

export function isModelAction(action: AgentAction): action is AssistantMessage {
  return 'role' in action
}

export function turnOf(action: AgentAction, results: ToolResultMessage[]): Turn {
  return isModelAction(action) ? { kind: 'model', message: action, results } : action
}

export function actionOf(turn: Turn): [AgentAction, ToolResultMessage[]] {
  return turn.kind === 'model' ? [turn.message, turn.results] : [turn, []]
}

export function applyTurn(state: AgentState, turn: Turn): AgentState {
  switch (turn.kind) {
    case 'model':
      return { ...state, messages: [...state.messages, turn.message, ...turn.results] }
    case 'input':
      return { ...state, messages: [...state.messages, ...turn.messages] }
    case 'rewrite':
      return { ...state, messages: turn.messages }
  }
}
