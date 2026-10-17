// What a client reads of a session: a run's events cut down to what a window shows, plus the questions and the state
// around them. A live run and a log read back give the same events (history.ts), so a session looks the same either way.

import type { RunEvent, ThinkingLevel, ToolResultMessage } from '@ji.dev/llm'
import type { Questions } from '@ji.dev/plugin-choices'
import type { HelpSection } from '../agent/commands.ts'
import type { Writer } from '../agent/conversation.ts'
import type { UsageReading } from '../agent/meter.ts'
import type { Mode } from '../features/permissions.ts'
import { STOPPED_MESSAGE } from '../agent/conversation.ts'
import { contentOf } from '../agent/messages.ts'

/** A tool's output is cut to this many characters in an event: a client shows it, the model already has it whole. */
const MAX_OUTPUT = 4_000

/** A question as a client shows it; its options are the yes, the shortcuts and the no of an approval. */
export interface QuestionView {
  title: string
  detail?: string
  options: { value: string; label: string; hint?: string }[]
  multiple: boolean
  other: boolean
  initial?: string
  /** What the typed answer is for, before one is typed. */
  placeholder?: string
  /** The typed answer is a key: shown as dots. */
  secret?: boolean
}

/** A command as a client's menu shows it, and what it takes when that is one of a few. */
export interface CommandView {
  name: string
  arg?: string
  hint: string
  group?: string
  choices?: string[]
}

export interface Usage {
  input: number
  output: number
  cost: number
}

export type Outcome = 'done' | 'stopped' | 'failed'

/** Everything a client shows around a session's conversation. */
export interface ServiceState {
  id: string
  root: string
  model: string
  thinking: ThinkingLevel
  thinkingLevels: ThinkingLevel[]
  /** OpenAI's priority tier, switched with /fast. */
  fast: boolean
  mode: Mode
  allowed: string
  replying: boolean
  queued: number
  tools: string[]
  /** The questions waiting for an answer, by id. */
  asking: string[]
  /** How the last reply ended; none before the first. */
  outcome?: Outcome
  /** The commands typed after a `/`, built-in ones first. */
  commands: CommandView[]
  /** What the session has spent so far, and how much the history holds. */
  usage: UsageReading
  /** Another process writes a reply to the session now: the terminal, say. Nothing can be sent until it ends. */
  heldBy?: Writer
}

/** What a client reads, in order of `seq`. */
export type ServiceEvent = { seq: number } & (
  | { type: 'user'; text: string; steer: boolean }
  | { type: 'thinking'; delta: string }
  | { type: 'text'; delta: string }
  | { type: 'tool_start'; id: string; name: string; args: string }
  | { type: 'tool_end'; id: string; name: string; ok: boolean; output: string; ms: number }
  | { type: 'ask'; id: string; tool?: string; outside: boolean; questions: QuestionView[] }
  | { type: 'ask_closed'; id: string }
  /** The history is being summarized, from its size now. */
  | { type: 'compacting'; tokens: number }
  /** `error` says why the history was kept as it was. */
  | { type: 'compacted'; before: number; after: number; error?: string }
  | { type: 'reply_end'; outcome: Outcome; error?: string; unsent?: string; usage: Usage }
  | { type: 'state'; state: ServiceState }
  /** What a command said, by how it went. */
  | { type: 'notice'; level: 'info' | 'success' | 'warn' | 'error'; text: string }
  /** What /help lists. */
  | { type: 'help'; sections: HelpSection[] }
)

/** An event before the log numbers it. */
export type Unnumbered = ServiceEvent extends infer E ? (E extends ServiceEvent ? Omit<E, 'seq'> : never) : never

/** A session's events, numbered and kept as they happen, so a client that connects late reads what it missed. */
export class EventLog {
  private readonly events: ServiceEvent[] = []
  private readonly listeners = new Set<(e: ServiceEvent) => void>()
  private seq = 0

  push(e: Unnumbered): void {
    const event = { ...e, seq: ++this.seq } as ServiceEvent
    this.events.push(event)
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  /** The events after `seq`: all of them with 0. */
  after(seq: number): ServiceEvent[] {
    return this.events.filter(e => e.seq > seq)
  }

  /** Called with every event from now on; returns what stops it. */
  subscribe(listener: (e: ServiceEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

/** What a client shows of a run event; the rest (steps, model calls, argument deltas) it does without. */
export function eventOf(e: RunEvent): Unnumbered | undefined {
  switch (e.type) {
    case 'thinking':
      return { type: 'thinking', delta: e.delta }
    case 'text':
      return { type: 'text', delta: e.delta }
    case 'tool_start':
      return { type: 'tool_start', id: e.call.id, name: e.call.name, args: JSON.stringify(e.call.arguments, null, 2) }
    case 'tool_end':
      return {
        type: 'tool_end',
        id: e.call.id,
        name: e.call.name,
        ok: !e.result.isError,
        output: cut(textOfResult(e.result)),
        ms: Math.round(e.ms),
      }
    case 'compaction:start':
      return { type: 'compacting', tokens: e.tokens }
    case 'compaction:end':
      return { type: 'compacted', before: e.before, after: e.after, error: e.error }
    case 'step_end':
      if (e.turn.kind !== 'input') {
        return undefined
      }
      return { type: 'user', text: e.turn.messages.map(contentOf).join('\n'), steer: !e.turn.idle }
    default:
      return undefined
  }
}

/** How a run ended, from its last event: a stop by the person reads as one, not as a failure. */
export function outcomeOf(e: Extract<RunEvent, { type: 'run_end' }>): { outcome: Outcome; error?: string } {
  if (e.outcome === 'done') {
    return { outcome: 'done' }
  }

  const { kind, message } = e.error
  if (kind === 'aborted' && message === STOPPED_MESSAGE) {
    return { outcome: 'stopped' }
  }
  return { outcome: 'failed', error: message }
}

/** What a run spent, as a client shows it. */
export function spentOf(e: Extract<RunEvent, { type: 'run_end' }>): Usage {
  const { input, output, cost } = e.summary.usage
  return { input, output, cost }
}

export function viewOf(q: Questions['questions'][number]): QuestionView {
  return {
    title: q.title,
    detail: q.detail,
    options: q.options.map(o => ({ ...o })),
    multiple: q.multiple ?? false,
    other: q.other ?? false,
    initial: q.initial,
  }
}

function textOfResult(result: ToolResultMessage): string {
  return result.content.map(part => (part.type === 'text' ? part.text : `[${part.type}]`)).join('\n')
}

function cut(text: string): string {
  return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n… ${text.length - MAX_OUTPUT} more characters` : text
}
