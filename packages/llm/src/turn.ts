import type { AssistantMessage, Message, ToolResultMessage } from '@mariozechner/pi-ai'
import type { Step } from '@pi-rsi/kernel'
import type { AgentAction, AgentState, RewriteAction, Turn } from './types.ts'
import { act, done } from '@pi-rsi/kernel'
import { lastAssistant } from './message.ts'

/**
 * 在 policy 中间件里返回它，用 messages 替换整个历史。
 * 生成新历史需要的 IO（例如调用模型写摘要）在 policy 里完成；替换本身由 update 完成，所以可以重放。
 */
export function rewriteHistory(messages: Message[]): Step<RewriteAction, never> {
  return act({ kind: 'rewrite', messages })
}

/** 在 policy 中间件里返回它，以最后一条助手消息作为结果结束运行 */
export function stop(state: AgentState): Step<never, AssistantMessage> {
  const last = lastAssistant(state)
  if (last === undefined) {
    throw new Error('stop: no assistant message to return')
  }

  return done(last)
}

/* ── 供内部使用：内核的 (action, obs) 与 Turn 互相转换 ─────────── */

export function isModelAction(action: AgentAction): action is AssistantMessage {
  return 'role' in action
}

export function turnOf(action: AgentAction, results: ToolResultMessage[]): Turn {
  return isModelAction(action) ? { kind: 'model', message: action, results } : action
}

export function actionOf(turn: Turn): [AgentAction, ToolResultMessage[]] {
  return turn.kind === 'model' ? [turn.message, turn.results] : [turn, []]
}

/** 内置的 update：把一条记录写入历史 */
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
