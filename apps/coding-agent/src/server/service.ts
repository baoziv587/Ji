// One session of the coding agent as a service: the same conversation, tools and approvals as the terminal, with every
// question and every piece of a reply turned into a plain event a client reads (events.ts), and every action a method
// a client calls. Several run side by side in one server (sessions.ts); the HTTP layer (http.ts) only carries them.
//
//   send        a message: starts a reply, or steers the one in progress
//   answer      a question the agent asked: an approval, or the model's ask_user
//   stop        the reply in progress
//   switchMode  ask <-> auto, as Shift+Tab in the terminal
//   think       the thinking level of the next model call
//
// Every event has a sequence number; the log keeps them all, those read back from the session's history first, so a
// client that connects late or comes back after a drop reads what it missed.

import type { Agent, Plugin, Run } from '@ji.dev/llm'
import type { Questions, Reply } from '@ji.dev/plugin-choices'
import type { Feature } from '../features/feature.ts'
import type { Permissions } from '../features/permissions.ts'
import type { Outcome, ServiceEvent, ServiceState, Unnumbered, Usage } from './events.ts'
import type { History } from './history.ts'
import { choices } from '@ji.dev/plugin-choices'
import { toolNamesOf } from '../agent/agent.ts'
import { Conversation } from '../agent/conversation.ts'
import { eventOf, usageOf, viewOf } from './events.ts'

export interface AgentServiceOptions {
  id: string
  root: string
  permissions: Permissions
  features: Feature[]
  /** Starts the agent with the features and the plugin that asks: the questions it asks go to the client. */
  start: (asking: Plugin) => Agent
  /** What the session said before, read back from its log: the conversation goes on from it. */
  history?: History
}

export interface AgentService {
  state: () => ServiceState
  /** The events of the log after `seq`: all of them with 0. */
  eventsAfter: (seq: number) => ServiceEvent[]
  /** Called with every event as it happens; returns what stops it. */
  subscribe: (listener: (e: ServiceEvent) => void) => () => void
  /** Whether the message started a reply or steers the one in progress. Throws when the model has no key. */
  send: (text: string) => Promise<'started' | 'steered'>
  /** False when no question has this id: answered already, or closed with its reply. */
  answer: (id: string, reply: Reply) => boolean
  stop: () => void
  switchMode: () => void
  /** Throws on a level the model does not take. */
  think: (level: string) => void
  /** Resolves once the reply in progress, if any, has ended. */
  settled: () => Promise<void>
}

interface Pending {
  resolve: (reply: Reply) => void
}

export function createAgentService(options: AgentServiceOptions): AgentService {
  const { id, root, permissions, features, start, history } = options
  const log: ServiceEvent[] = []
  let seq = 0
  const listeners = new Set<(e: ServiceEvent) => void>()
  const pending = new Map<string, Pending>()
  let questions = 0
  let replying: Promise<void> = Promise.resolve()
  let outcome: Outcome | undefined = history?.outcome

  const emit = (e: Unnumbered): void => {
    const event = { ...e, seq: ++seq } as ServiceEvent
    log.push(event)
    for (const listener of listeners) {
      listener(event)
    }
  }
  history?.events.forEach(emit)

  /** Every question goes to the client, and waits for its answer or for the step to be cancelled. */
  const ask = async (q: Questions, signal: AbortSignal): Promise<Reply> => {
    const approval = q.call === undefined ? undefined : await permissions.approval(q.call)
    const question = String(++questions)
    const shown = q.questions.map(viewOf)
    if (approval !== undefined) {
      const [yes, no] = shown[0].options
      shown[0].options = [yes, ...approval.shortcuts(), no]
    }

    const { promise, resolve, reject } = Promise.withResolvers<Reply>()
    const close = (): void => {
      pending.delete(question)
      emit({ type: 'ask_closed', id: question })
      emitState()
    }
    const cancel = (): void => {
      close()
      reject(signal.reason)
    }
    signal.addEventListener('abort', cancel, { once: true })
    pending.set(question, {
      resolve: reply => {
        signal.removeEventListener('abort', cancel)
        close()
        resolve(reply)
      },
    })

    emit({ type: 'ask', id: question, tool: q.call?.name, outside: approval?.outside ?? false, questions: shown })
    emitState()
    const reply = await promise
    return approval === undefined ? reply : approval.take(reply)
  }

  const asking = choices({ answer: ask, approve: features.flatMap(f => f.approve ?? []) })
  const conversation = new Conversation(start(asking), { id, state: history?.state })
  const tools = toolNamesOf(features, asking)

  const state = (): ServiceState => {
    const { model, thinking } = conversation.agent
    return {
      id,
      root,
      model: `${model.provider}/${model.id}`,
      thinking,
      thinkingLevels: [...model.thinkingLevels],
      mode: permissions.mode,
      allowed: permissions.describeAllowed(),
      replying: conversation.replying,
      queued: conversation.queued,
      tools,
      asking: [...pending.keys()],
      outcome,
    }
  }

  function emitState(): void {
    emit({ type: 'state', state: state() })
  }

  /** The reply's events as the client's; what it spent, once it ends. */
  const read = async (run: Run, usage: Usage): Promise<void> => {
    for await (const e of run) {
      const event = eventOf(e)
      if (event !== undefined) {
        emit(event)
      }
      if (e.type === 'run_end') {
        Object.assign(usage, usageOf(e))
      }
      if (e.type === 'step_end' && e.turn.kind === 'input') {
        // A steer reached the model: the queue is one shorter
        emitState()
      }
    }
  }

  const follow = async (run: Run): Promise<void> => {
    const usage: Usage = { input: 0, output: 0, cost: 0 }
    const unfinished = await conversation.follow(run, r => read(r, usage))
    if (unfinished === undefined) {
      outcome = 'done'
      emit({ type: 'reply_end', outcome, usage })
    } else {
      const { stopped, error, sent } = unfinished
      outcome = stopped ? 'stopped' : 'failed'
      emit({
        type: 'reply_end',
        outcome,
        error: stopped ? undefined : error instanceof Error ? error.message : String(error),
        unsent: sent.join(' '),
        usage,
      })
    }
    emitState()
  }

  // The client knows the session, a new one or one read back from its log, from its first events on
  emitState()

  return {
    state,
    eventsAfter: after => log.filter(e => e.seq > after),
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    send: async text => {
      const { model } = conversation.agent
      if (!(await model.hasKey())) {
        throw new Error(
          `No key for ${model.provider}: run /login ${model.provider} in the terminal coding agent, or set its API key variable.`,
        )
      }

      const run = conversation.send(text)
      emitState()
      if (run === undefined) {
        return 'steered'
      }
      replying = follow(run)
      return 'started'
    },
    answer: (question, reply) => {
      const waiting = pending.get(question)
      waiting?.resolve(reply)
      return waiting !== undefined
    },
    stop: () => conversation.stop(),
    switchMode: () => {
      permissions.switchMode()
      emitState()
    },
    think: level => {
      const found = conversation.agent.model.thinkingLevels.find(l => l === level)
      if (found === undefined) {
        throw new Error(
          `"${level}" is not a thinking level of this model: ${conversation.agent.model.thinkingLevels.join(', ')}`,
        )
      }
      conversation.think(found)
      emitState()
    },
    settled: () => replying,
  }
}
