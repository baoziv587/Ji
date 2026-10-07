// @ji.dev/testing: a model that says what the test scripted, for tests and offline examples.
//
// pi-ai's faux provider does the work; this is the only place that knows its shape, so a change to it (the request a
// scripted reply sees, how a fake registers) is absorbed here and reaches no test.

import type {
  Api,
  AssistantMessage,
  Message,
  Model,
  SimpleStreamOptions,
  ThinkingLevel,
  ToolCall,
  TranscriptContext,
} from '@earendil-works/pi-ai'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxThinking,
  fauxToolCall,
  getCurrentSystemPrompt,
  getInitialSystemMessage,
  withoutInitialSystemMessage,
} from '@earendil-works/pi-ai'
import { registerProvider } from '@ji.dev/models'

/** What the model was asked, as a scripted reply sees it. */
export interface FakeRequest {
  /** The history, without the system message. */
  messages: Message[]
  system: string
  /** The names of the tools offered. */
  tools: string[]
  /** The level the request carries; undefined when none, as for a model that cannot think or a level of off. */
  thinking: ThinkingLevel | undefined
  /** Aborted when the run stops the call. */
  signal: AbortSignal | undefined
}

/** A reply as scripted: a message, or a function of the request that makes one. */
export type FakeReply = AssistantMessage | ((request: FakeRequest) => AssistantMessage | Promise<AssistantMessage>)

export interface FakeModelOptions {
  /** The model's id; 'faux' by default. */
  id?: string
  /** Whether the model takes a thinking level; false by default. */
  reasoning?: boolean
  /** Streams this many tokens a second, yielding between them; unthrottled by default, in microtasks. */
  tokensPerSecond?: number
  /** The provider name the model shows; 'faux-1', 'faux-2', … by default, so fakes alive at once stay apart. */
  provider?: string
}

export interface FakeModel {
  /** What createAgent takes. */
  model: Model<Api>
  /** Replaces the replies still to come. */
  script: (...replies: FakeReply[]) => void
  /** How many times the model was called. */
  calls: () => number
  /** How many scripted replies are still to come. */
  pending: () => number
  /** Unregisters the provider; call it once the test ends. */
  dispose: () => void
}

let fakes = 0

/** A model that gives `replies` in order and fails once they run out. */
export function createFakeModel(replies: FakeReply[] = [], options: FakeModelOptions = {}): FakeModel {
  const { id = 'faux', reasoning = false, tokensPerSecond, provider = `faux-${++fakes}` } = options
  const faux = fauxProvider({ models: [{ id, reasoning }], tokensPerSecond, provider })
  const unregister = registerProvider(faux.provider)

  const script = (...next: FakeReply[]): void => {
    faux.setResponses(next.map(reply => (typeof reply === 'function' ? asFactory(reply) : reply)))
  }
  script(...replies)

  return {
    model: faux.getModel(),
    script,
    calls: () => faux.state.callCount,
    pending: () => faux.getPendingResponseCount(),
    dispose: unregister,
  }
}

/** An assistant message; its stop reason is toolUse when it calls tools, unless given. */
export function assistantMessage(
  content: string | ContentBlock | ContentBlock[],
  options: { stopReason?: AssistantMessage['stopReason']; errorMessage?: string } = {},
): AssistantMessage {
  const blocks = typeof content === 'string' ? [] : Array.isArray(content) ? content : [content]
  const stopReason = options.stopReason ?? (blocks.some(b => b.type === 'toolCall') ? 'toolUse' : 'stop')
  return fauxAssistantMessage(content, { stopReason, errorMessage: options.errorMessage })
}

export type ContentBlock = ReturnType<typeof fauxText> | ReturnType<typeof fauxThinking> | ToolCall

export function toolUse(name: string, args: ToolCall['arguments'], options: { id?: string } = {}): ToolCall {
  return fauxToolCall(name, args, options)
}

export function textBlock(text: string): ContentBlock {
  return fauxText(text)
}

export function thinkingBlock(thinking: string): ContentBlock {
  return fauxThinking(thinking)
}

function asFactory(reply: (request: FakeRequest) => AssistantMessage | Promise<AssistantMessage>) {
  return (context: TranscriptContext, options: SimpleStreamOptions | undefined) => reply(requestOf(context, options))
}

function requestOf(context: TranscriptContext, options: SimpleStreamOptions | undefined): FakeRequest {
  const tools = getInitialSystemMessage(context.messages)?.toolsAdded ?? []
  return {
    messages: withoutInitialSystemMessage(context.messages),
    system: getCurrentSystemPrompt(context.messages),
    tools: tools.map(t => t.name),
    thinking: options?.reasoning,
    signal: options?.signal,
  }
}
