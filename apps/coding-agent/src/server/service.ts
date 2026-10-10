// One session of the coding agent as a service: the same conversation, tools and approvals as the terminal, with every
// question and every piece of a reply turned into a plain event a client reads (events.ts), and every action a method
// a client calls. Several run side by side in one server (sessions.ts); the HTTP layer (http.ts) only carries them.
//
//   send        a message: starts a reply, or steers the one in progress
//   command     a line that names a command, as typed in the terminal: /think high, /login openai, a skill's
//   answer      a question the agent asked: an approval, or the model's ask_user
//   stop        the reply in progress
//   switchMode  ask <-> auto, as Shift+Tab in the terminal
//   think       the thinking level of the next model call
//
// Every event has a sequence number; the log keeps them all, those read back from the session's history first, so a
// client that connects late or comes back after a drop reads what it missed.

import type { Agent, AuthEvent, AuthInteraction, AuthPrompt, Plugin, Run } from '@ji.dev/llm'
import type { Questions, Reply } from '@ji.dev/plugin-choices'
import type { Command, Say } from '../agent/commands.ts'
import type { Feature } from '../features/feature.ts'
import type { Permissions } from '../features/permissions.ts'
import type { CommandView, Outcome, QuestionView, ServiceEvent, ServiceState, Unnumbered, Usage } from './events.ts'
import type { History } from './history.ts'
import { choices, DISMISSED } from '@ji.dev/plugin-choices'
import { contextLimitOf, toolNamesOf } from '../agent/agent.ts'
import { commandOf, createCommands } from '../agent/commands.ts'
import { Conversation } from '../agent/conversation.ts'
import { UsageMeter } from '../agent/meter.ts'
import { openBrowser } from '../ui/login.ts'
import { eventOf, usageOf, viewOf } from './events.ts'

export interface AgentServiceOptions {
  id: string
  root: string
  permissions: Permissions
  /** The features, made with where their commands talk to: the client. */
  features: (client: CommandClient) => Feature[]
  /** Starts the agent with the features and the plugin that asks: the questions it asks go to the client. */
  start: (asking: Plugin, features: Feature[]) => Agent
  /** What the session said before, read back from its log: the conversation goes on from it. */
  history?: History
}

/** Where a feature's commands talk to the client: what they say, what a login asks, and that the commands changed. */
export interface CommandClient {
  say: Say
  interaction: AuthInteraction
  /** The commands are not what they were: a folder of skills was read, say. */
  changed: () => void
}

export interface AgentService {
  state: () => ServiceState
  /** The events of the log after `seq`: all of them with 0. */
  eventsAfter: (seq: number) => ServiceEvent[]
  /** Called with every event as it happens; returns what stops it. */
  subscribe: (listener: (e: ServiceEvent) => void) => () => void
  /** Whether the message started a reply or steers the one in progress. Throws when the model has no key. */
  send: (text: string) => Promise<'started' | 'steered'>
  /**
   * Runs the command the line names, what it says going out as events; one that only the model knows, a skill's, goes
   * as a message. Throws as send does.
   */
  command: (line: string) => Promise<'ran' | 'started' | 'steered'>
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
  const { id, root, permissions, start, history } = options
  const log: ServiceEvent[] = []
  let seq = 0
  const listeners = new Set<(e: ServiceEvent) => void>()
  const pending = new Map<string, Pending>()
  let questions = 0
  let replying: Promise<void> = Promise.resolve()
  let outcome: Outcome | undefined = history?.outcome
  const meter = history?.meter ?? new UsageMeter()

  const emit = (e: Unnumbered): void => {
    const event = { ...e, seq: ++seq } as ServiceEvent
    log.push(event)
    for (const listener of listeners) {
      listener(event)
    }
  }
  history?.events.forEach(emit)

  /** Questions go to the client, and wait for its answer or for `signal` to be aborted. */
  const question = (
    shown: QuestionView[],
    signal: AbortSignal | undefined,
    call: { tool?: string; outside: boolean } = { outside: false },
  ): Promise<Reply> => {
    const asked = String(++questions)
    const { promise, resolve, reject } = Promise.withResolvers<Reply>()
    const close = (): void => {
      pending.delete(asked)
      emit({ type: 'ask_closed', id: asked })
      emitState()
    }
    const cancel = (): void => {
      close()
      reject(signal?.reason)
    }
    signal?.addEventListener('abort', cancel, { once: true })
    pending.set(asked, {
      resolve: reply => {
        signal?.removeEventListener('abort', cancel)
        close()
        resolve(reply)
      },
    })

    emit({ type: 'ask', id: asked, ...call, questions: shown })
    emitState()
    return promise
  }

  /** The model's questions, and the approvals of its calls with what a yes can allow besides. */
  const ask = async (q: Questions, signal: AbortSignal): Promise<Reply> => {
    const approval = q.call === undefined ? undefined : await permissions.approval(q.call)
    const shown = q.questions.map(viewOf)
    if (approval !== undefined) {
      const [yes, no] = shown[0].options
      shown[0].options = [yes, ...approval.shortcuts(), no]
    }

    const reply = await question(shown, signal, { tool: q.call?.name, outside: approval?.outside ?? false })
    return approval === undefined ? reply : approval.take(reply)
  }

  /** What a command says goes to the client, with the state it may have changed. */
  const tell =
    (level: 'info' | 'success' | 'warn' | 'error') =>
    (text: string): void => {
      emit({ type: 'notice', level, text })
      emitState()
    }
  const say: Say = { info: tell('info'), success: tell('success'), warn: tell('warn'), error: tell('error') }

  /** A login asks the client, and says how it goes; the browser opens here, where the service runs. */
  const interaction: AuthInteraction = {
    prompt: async p => {
      const reply = await question([questionOf(p)], p.signal)
      if (reply === DISMISSED) {
        throw new Error('Login cancelled')
      }
      return reply[0]?.[0] ?? ''
    },
    notify: e => {
      if (e.type === 'auth_url') {
        openBrowser(e.url)
      }
      say.info(describeAuthEvent(e))
    },
  }

  const features = options.features({ say, interaction, changed: () => emitState() })
  const asking = choices({ answer: ask, approve: features.flatMap(f => f.approve ?? []) })
  const conversation = new Conversation(start(asking, features), { id, state: history?.state })
  const tools = toolNamesOf(features, asking)

  /** The reply's events as the client's; what it spent, once it ends. */
  const read = async (run: Run, usage: Usage): Promise<void> => {
    for await (const e of run) {
      meter.take(e)
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
      if (e.type === 'model_end' || e.type === 'model_error' || e.type === 'compaction:end') {
        // What it spent, or the history's new size
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

  const send = async (text: string): Promise<'started' | 'steered'> => {
    const { model } = conversation.agent
    if (!(await model.hasKey())) {
      throw new Error(
        `No key for ${model.provider}: log in with /login ${model.provider}, or set its API key variable.`,
      )
    }

    const run = conversation.send(text)
    emitState()

    if (run === undefined) {
      return 'steered'
    }

    replying = follow(run)
    return 'started'
  }

  const commands = createCommands({
    conversation,
    tools,
    mode: () => permissions.describeMode(),
    send: message => {
      send(message).catch((error: unknown) => say.error(error instanceof Error ? error.message : String(error)))
    },
    quit: () => say.info('Nothing to quit in a session of the service: close its window.'),
    say,
    help: sections => emit({ type: 'help', sections }),
    extra: () => features.flatMap(f => f.commands ?? []),
  })

  const state = (): ServiceState => {
    const { model, thinking } = conversation.agent
    return {
      id,
      root,
      model: `${model.provider}/${model.id}`,
      thinking,
      thinkingLevels: [...model.thinkingLevels],
      fast: conversation.fast,
      mode: permissions.mode,
      allowed: permissions.describeAllowed(),
      replying: conversation.replying,
      queued: conversation.queued,
      tools,
      asking: [...pending.keys()],
      outcome,
      commands: commands().map(viewOfCommand),
      usage: meter.reading(contextLimitOf(model)),
    }
  }

  function emitState(): void {
    emit({ type: 'state', state: state() })
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
    send,
    command: async line => {
      const named = commandOf(commands(), line)
      if (named === undefined) {
        return send(line)
      }

      const { command, name, arg } = named
      if (command === undefined) {
        say.warn(`No such command: ${name}. /help lists them.`)
        return 'ran'
      }
      if (command.run === undefined) {
        return send(line)
      }

      command.run(arg)
      return 'ran'
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

function viewOfCommand({ name, arg, hint, group, choices }: Command): CommandView {
  return { name, arg, hint, group, choices: choices?.() }
}

/** A login's prompt as a question: a choice, or a line to type, a key's in dots. */
function questionOf(p: AuthPrompt): QuestionView {
  if (p.type === 'select') {
    const options = p.options.map(o => ({ value: o.id, label: o.label, hint: o.description }))
    return { title: p.message, options, multiple: false, other: false }
  }

  return {
    title: p.message,
    options: [],
    multiple: false,
    other: true,
    placeholder: p.placeholder,
    secret: p.type === 'secret',
  }
}

/** As the terminal tells it (ui/login.ts). */
function describeAuthEvent(e: AuthEvent): string {
  switch (e.type) {
    case 'auth_url':
      return [`Open ${e.url}`, ...(e.instructions === undefined ? [] : [e.instructions])].join('\n')
    case 'device_code':
      return `Go to ${e.verificationUri} and enter ${e.userCode}`
    case 'info':
      return [e.message, ...(e.links ?? []).map(l => l.url)].join('\n')
    default:
      return e.message
  }
}
