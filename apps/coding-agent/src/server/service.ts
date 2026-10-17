// One session of the coding agent as a service: the same conversation, tools and approvals as the terminal, with every
// question and every piece of a reply turned into a plain event a client reads (events.ts), and every action a method
// a client calls. Several run side by side in one server (sessions.ts); the HTTP layer (http.ts) only carries them.
//
//   send        a message: starts a reply, or steers the one in progress
//   command     a line that names a command, as typed in the terminal: /think high, /login openai, a skill's
//   answer      a question the agent asked: an approval, or the model's ask_user
//   stop        the reply in progress
//   switchMode  ask <-> auto, as Shift+Tab in the terminal
//   setMode     ask, auto or yolo: the one way out of yolo
//   think       the thinking level of the next model call
//   useModel    the model of the next reply, 'provider/id'
//
// Every event has a sequence number; the log keeps them all, those read back from the session's history first, so a
// client that connects late or comes back after a drop reads what it missed.

import type { Agent, AgentState, AuthInteraction, Plugin, Run } from '@ji.dev/llm'
import type { Questions, Reply } from '@ji.dev/plugin-choices'
import type { StartOptions } from '../agent/agent.ts'
import type { Command, Say } from '../agent/commands.ts'
import type { ReplyLock, Unfinished, Writer } from '../agent/conversation.ts'
import type { Feature } from '../features/feature.ts'
import type { Mode, Permissions } from '../features/permissions.ts'
import type { CommandView, Outcome, ServiceEvent, ServiceState, Unnumbered, Usage } from './events.ts'
import type { History, LogRecord } from './history.ts'
import { choices } from '@ji.dev/plugin-choices'
import { errorMessage } from '@ji.dev/utils'
import { contextLimitOf, startAgent, startOn, toolNamesOf } from '../agent/agent.ts'
import { createCommands, runCommand } from '../agent/commands.ts'
import { Conversation } from '../agent/conversation.ts'
import { UsageMeter } from '../agent/meter.ts'
import { EventLog, eventOf, spentOf, viewOf } from './events.ts'
import { replay } from './history.ts'
import { loginInteraction } from './login.ts'
import { PendingQuestions } from './questions.ts'

export interface AgentServiceOptions {
  id: string
  root: string
  permissions: Permissions
  /** The features, made with where their commands talk to: the client. */
  features: (client: CommandClient) => Feature[]
  /**
   * What the agent starts with, given the features and the plugin that asks: the questions it asks go to the client.
   * A switch of model starts it again from these.
   */
  start: (asking: Plugin, features: Feature[]) => StartOptions
  /** What the session said before, read back from its log: the conversation goes on from it. */
  history?: History
  /** The session's lock and log, as the terminal shares them: each reply takes the lock, and goes on from its log. */
  shared?: SharedLog
}

/** A session's lock and log, shared with the terminal. */
export interface SharedLog {
  /** Throws SessionBusyError while the terminal replies in the session. */
  lock: () => void
  unlock: () => void
  /** What the terminal appended to the log since it was last read. */
  unread: () => LogRecord[]
  /** The history, the whole log read again. */
  history: () => AgentState
}

/** Where a feature's commands talk to the client: what they say, what a login asks, and that the commands changed. */
export interface CommandClient {
  say: Say
  interaction: AuthInteraction
  /** The commands are not what they were: a folder of skills was read, say. */
  changed: () => void
}

type NoticeLevel = Extract<Unnumbered, { type: 'notice' }>['level']

export class AgentService {
  readonly id: string
  readonly root: string
  private readonly permissions: Permissions
  private readonly log = new EventLog()
  private readonly questions: PendingQuestions
  private readonly meter: UsageMeter
  private readonly say: Say
  private readonly features: Feature[]
  private readonly conversation: Conversation
  private readonly started: StartOptions
  private readonly tools: string[]
  private readonly commands: () => Command[]
  /** How the last reply ended; none before the first. */
  private outcome: Outcome | undefined
  private heldBy: Writer | undefined
  /** The terminal wrote to the log since the conversation was read from it: the next reply reads it again. */
  private behind = false
  private replying: Promise<void> = Promise.resolve()

  constructor(options: AgentServiceOptions) {
    const { id, root, permissions, start, history } = options
    this.id = id
    this.root = root
    this.permissions = permissions
    this.outcome = history?.outcome
    this.meter = history?.meter ?? new UsageMeter()
    history?.events.forEach(e => this.log.push(e))

    this.questions = new PendingQuestions(e => {
      this.log.push(e)
      this.emitState()
    })
    this.say = sayingTo((level, text) => {
      this.log.push({ type: 'notice', level, text })
      this.emitState()
    })

    const interaction = loginInteraction((shown, signal) => this.questions.ask(shown, signal), this.say)
    this.features = options.features({ say: this.say, interaction, changed: () => this.emitState() })

    const asking = choices({
      answer: (q, signal) => this.ask(q, signal),
      approve: this.features.flatMap(f => f.approve ?? []),
    })
    this.started = start(asking, this.features)
    const lock = options.shared === undefined ? undefined : this.lockOf(options.shared)
    this.conversation = new Conversation(startAgent(this.started), { id, state: history?.state }, lock)
    this.tools = toolNamesOf(this.features, asking)

    this.commands = createCommands({
      conversation: this.conversation,
      tools: this.tools,
      mode: () => permissions.describeMode(),
      send: message => {
        this.send(message).catch((error: unknown) => this.say.error(errorMessage(error)))
      },
      quit: () => this.say.info('Nothing to quit in a session of the service: close its window.'),
      say: this.say,
      help: sections => this.log.push({ type: 'help', sections }),
      extra: () => this.features.flatMap(f => f.commands ?? []),
      startOn: spec => this.startOn(spec),
    })

    // The client knows the session, a new one or one read back from its log, from its first events on
    this.emitState()
  }

  state(): ServiceState {
    const { model, thinking } = this.conversation.agent
    return {
      id: this.id,
      root: this.root,
      model: `${model.provider}/${model.id}`,
      thinking,
      thinkingLevels: [...model.thinkingLevels],
      fast: this.conversation.fast,
      mode: this.permissions.mode,
      allowed: this.permissions.describeAllowed(),
      replying: this.conversation.replying,
      queued: this.conversation.queued,
      tools: this.tools,
      asking: this.questions.ids(),
      outcome: this.outcome,
      commands: this.commands().map(viewOfCommand),
      usage: this.meter.reading(contextLimitOf(model)),
      heldBy: this.heldBy,
    }
  }

  /** What another process appended to the session's log, shown as if this one wrote it. */
  written(records: readonly LogRecord[]): void {
    if (records.length === 0) {
      return
    }

    this.behind = true
    this.outcome = replay(records, this.meter, event => this.log.push(event)) ?? this.outcome
    this.emitState()
  }

  /** Who else writes a reply to the session now; none once it has ended. */
  setHeldBy(by: Writer | undefined): void {
    if (by !== this.heldBy) {
      this.heldBy = by
      this.emitState()
    }
  }

  /** The events of the log after `seq`: all of them with 0. */
  eventsAfter(seq: number): ServiceEvent[] {
    return this.log.after(seq)
  }

  /** Called with every event as it happens; returns what stops it. */
  subscribe(listener: (e: ServiceEvent) => void): () => void {
    return this.log.subscribe(listener)
  }

  /** Whether the message started a reply or steers the one in progress. Throws when the model has no key. */
  async send(text: string): Promise<'started' | 'steered'> {
    const { model } = this.conversation.agent
    if (!(await model.hasKey())) {
      throw new Error(
        `No key for ${model.provider}: log in with /login ${model.provider}, or set its API key variable.`,
      )
    }

    const run = this.conversation.send(text)
    this.emitState()

    if (run === undefined) {
      return 'steered'
    }

    this.replying = this.follow(run)
    return 'started'
  }

  /**
   * Runs the command the line names, what it says going out as events; one that only the model knows, a skill's, goes
   * as a message. Throws as send does.
   */
  async command(line: string): Promise<'ran' | 'started' | 'steered'> {
    if (runCommand(this.commands(), line, text => this.say.warn(text)) === 'send') {
      return this.send(line)
    }
    return 'ran'
  }

  /** False when no question has this id: answered already, or closed with its reply. */
  answer(id: string, reply: Reply): boolean {
    return this.questions.answer(id, reply)
  }

  stop(): void {
    this.conversation.stop()
  }

  switchMode(): void {
    this.permissions.switchMode()
    this.emitState()
  }

  /** A question already asked stays as it is: the calls after it follow the new mode. */
  setMode(mode: Mode): void {
    this.permissions.setMode(mode)
    this.emitState()
  }

  /** Throws on a level the model does not take. */
  think(level: string): void {
    const { thinkingLevels } = this.conversation.agent.model
    const found = thinkingLevels.find(l => l === level)
    if (found === undefined) {
      throw new Error(`"${level}" is not a thinking level of this model: ${thinkingLevels.join(', ')}`)
    }

    this.conversation.think(found)
    this.emitState()
  }

  /** Throws on a model the catalog does not have, and while a reply is in progress. */
  useModel(spec: string): void {
    this.conversation.use(this.startOn(spec))
    this.emitState()
  }

  /** Resolves once the reply in progress, if any, has ended. */
  settled(): Promise<void> {
    return this.replying
  }

  /** The model's questions, and the approvals of its calls with what a yes can allow besides. */
  private async ask(q: Questions, signal: AbortSignal): Promise<Reply> {
    const approval = q.call === undefined ? undefined : await this.permissions.approval(q.call)
    const shown = q.questions.map(viewOf)
    if (approval !== undefined) {
      const [yes, no] = shown[0].options
      shown[0].options = [yes, ...approval.shortcuts(), no]
    }

    const reply = await this.questions.ask(shown, signal, { tool: q.call?.name, outside: approval?.outside ?? false })
    return approval === undefined ? reply : approval.take(reply)
  }

  private async follow(run: Run): Promise<void> {
    const usage: Usage = { input: 0, output: 0, cost: 0 }
    const unfinished = await this.conversation.follow(run, r => this.read(r, usage))
    const end = replyEndOf(unfinished, usage)
    this.outcome = end.outcome

    this.log.push(end)
    this.emitState()
  }

  /** The reply's events as the client's; what it spent, once it ends. */
  private async read(run: Run, usage: Usage): Promise<void> {
    for await (const e of run) {
      this.meter.take(e)
      const event = eventOf(e)
      if (event !== undefined) {
        this.log.push(event)
      }
      if (e.type === 'run_end') {
        Object.assign(usage, spentOf(e))
      }
      if (e.type === 'step_end' && e.turn.kind === 'input') {
        // A steer reached the model: the queue is one shorter
        this.emitState()
      }
      if (e.type === 'model_end' || e.type === 'model_error' || e.type === 'compaction:end') {
        // What it spent, or the history's new size
        this.emitState()
      }
    }
  }

  /** Each reply takes the lock, after what the terminal wrote since: the history goes on from it. */
  private lockOf(shared: SharedLog): ReplyLock {
    return {
      claim: () => {
        shared.lock()
        this.written(shared.unread())
        if (!this.behind) {
          return undefined
        }
        this.behind = false
        return shared.history()
      },
      release: shared.unlock,
    }
  }

  private startOn(spec: string): Agent {
    return startOn(spec, { ...this.started, thinking: this.conversation.agent.thinking })
  }

  private emitState(): void {
    this.log.push({ type: 'state', state: this.state() })
  }
}

/** What a command says, each level told to `tell`. */
function sayingTo(tell: (level: NoticeLevel, text: string) => void): Say {
  return {
    info: text => tell('info', text),
    success: text => tell('success', text),
    warn: text => tell('warn', text),
    error: text => tell('error', text),
  }
}

function viewOfCommand({ name, arg, hint, group, choices }: Command): CommandView {
  return { name, arg, hint, group, choices: choices?.() }
}

/** How a reply ended, as the client reads it: done, or stopped or failed with what it was sent. */
function replyEndOf(unfinished: Unfinished | undefined, usage: Usage): Extract<Unnumbered, { type: 'reply_end' }> {
  if (unfinished === undefined) {
    return { type: 'reply_end', outcome: 'done', usage }
  }

  const { stopped, error, sent } = unfinished
  return {
    type: 'reply_end',
    outcome: stopped ? 'stopped' : 'failed',
    error: stopped ? undefined : errorMessage(error),
    unsent: sent.join(' '),
    usage,
  }
}
