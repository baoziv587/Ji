// What a client reads of a session: a run's events cut down to what a window shows, plus the questions and the state
// around them. A live run and a log read back give the same events (history.ts), so a session looks the same either way.

import type { RunEvent, ThinkingLevel, ToolResultMessage } from '@ji.dev/llm'
import type { Questions } from '@ji.dev/plugin-choices'
import type { HelpSection } from '../agent/commands.ts'
import type { UsageReading } from '../agent/meter.ts'

/** A tool's output is cut to this many characters in an event: a client shows it, the model already has it whole. */
const MAX_OUTPUT = 4_000

/** The error a person's stop ends a reply with (agent/conversation.ts), as it reads in a log. */
const STOPPED = 'stopped by user'

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
  mode: string
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
  | { type: 'compacted'; before: number; after: number }
  | { type: 'reply_end'; outcome: Outcome; error?: string; unsent?: string; usage: Usage }
  | { type: 'state'; state: ServiceState }
  /** What a command said, by how it went. */
  | { type: 'notice'; level: 'info' | 'success' | 'warn' | 'error'; text: string }
  /** What /help lists. */
  | { type: 'help'; sections: HelpSection[] }
)

/** An event before the log numbers it. */
export type Unnumbered = ServiceEvent extends infer E ? (E extends ServiceEvent ? Omit<E, 'seq'> : never) : never

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
    case 'compaction:end':
      return { type: 'compacted', before: e.before, after: e.after }
    case 'step_end':
      if (e.turn.kind !== 'input') {
        return undefined
      }
      return { type: 'user', text: e.turn.messages.map(textOfMessage).join('\n'), steer: !e.turn.idle }
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
  return kind === 'aborted' && message === STOPPED ? { outcome: 'stopped' } : { outcome: 'failed', error: message }
}

export function usageOf(e: Extract<RunEvent, { type: 'run_end' }>): Usage {
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

/** A message's text, its content a string or a list of parts. */
function textOfMessage(message: { content: unknown }): string {
  const { content } = message
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return ''
  }
  return content.map(part => (part.type === 'text' ? String(part.text) : '')).join('')
}

function cut(text: string): string {
  return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n… ${text.length - MAX_OUTPUT} more characters` : text
}
