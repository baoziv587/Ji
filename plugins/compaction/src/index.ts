// @ji.dev/plugin-compaction: when the history grows past maxTokens, the older part becomes a summary
//
//   messages   [ 0 ........................ cut )[ cut ......... end )
//                summarized by the model           kept verbatim, about keepRecentTokens
//   become     [ summary ][ cut ......... end )
//
//   A decide hook: it runs before a step's model call, so the call itself already sends the shorter history. The
//   replacement goes through record as rewriteHistory, so it lands in AgentState and a restored session does not
//   summarize again.

import type { Api, Message, Model, Plugin } from '@ji.dev/llm'
import { callsOf, definePlugin, rewriteHistory, textOf, user } from '@ji.dev/llm'

declare module '@ji.dev/llm' {
  interface Events {
    'compaction:start': { tokens: number }
    /** `after` equals `before` and `error` says why when the history was kept as it was. */
    'compaction:end': { before: number; after: number; error?: string }
  }
}

export interface CompactionOptions {
  /** Compact once the history is over this many tokens; well under the model's context window. */
  maxTokens: number
  /** About how many of the latest tokens to keep verbatim. Default: a fifth of maxTokens. */
  keepRecentTokens?: number
  /** Model that writes the summary. Default: the agent's; a cheaper one is fine. */
  model?: Model<Api>
  /** Give up on the summary after this many ms and keep the long history for this step. Default: no limit. */
  timeoutMs?: number
}

/** What the plugin keeps between steps: since which message the history's own usage figures can be trusted. */
export interface CompactionState {
  /** Assistant messages before this index were sent with a history since replaced, so their usage is stale. */
  freshFrom: number
}

export const SUMMARY_PREFIX = '[Summary of the earlier conversation]'

/** Tokens an image counts for; providers charge from about 1k to a few k, depending on its size. */
const IMAGE_TOKENS = 1_500

/** U+DC00 to U+DFFF, the second halves of surrogate pairs. Decimal: the formatter and the linter disagree on hex case. */
const LOW_SURROGATES = [56_320, 57_343] as const

/**
 * A tool call's arguments and a tool result's text are cut to this many characters in the transcript the summary is
 * written from: a whole file written or read would otherwise swell the summary request.
 */
const TOOL_PART_CHARS = 2_000

const SUMMARIZE = `You compress the earlier part of a conversation between a user and a coding assistant, so the assistant can continue it without the original messages.
Write a summary with these sections, leaving out any that would be empty:
- Goal: what the user is trying to achieve, and their constraints and preferences.
- Done: what has been completed, with the files, commands and results that matter.
- Decisions: what was decided and why.
- Open: what is in progress or still to do, and the next step.
- Facts: exact names, paths, values, errors and snippets the assistant will need again.
An earlier summary may open the transcript: fold it in, do not drop it. Be concise but keep every detail needed to continue. Write in the user's language.`

/**
 * Context compaction. Before a step's model call, if the history is over maxTokens, the model summarizes the older
 * messages and the history becomes "summary + the latest messages".
 *
 * - The size is the provider's own count from the last assistant message's usage, plus an estimate for what came after
 *   it; without usage it is all an estimate. The estimate counts a non-ASCII character as a token, so CJK text is not
 *   undercounted.
 * - The summary comes from ctx.complete: it goes through the agent's request plugins, is cancelled with the step,
 *   shows as model events with `by: 'compaction'`, and counts in r.summary.usage.
 * - A summary that fails, comes back empty or runs out of time leaves the history as it was for this step, and says
 *   why in compaction:end: the run goes on, and the next step tries again. Cancelling the step still cancels the run.
 * - An idle history is left alone: the run is ending, and compacting would only keep the user waiting. The next
 *   step that calls the model compacts instead.
 */
export function createCompactionPlugin({
  maxTokens,
  keepRecentTokens = Math.floor(maxTokens / 5),
  model,
  timeoutMs,
}: CompactionOptions): Plugin<CompactionState> {
  return definePlugin({
    name: 'compaction',

    state: {
      init: { freshFrom: 0 },
      reduce: (own, turn) => (turn.kind === 'rewrite' ? { freshFrom: turn.messages.length } : own),
    },

    async *decide(state, next, { complete, signal, own }) {
      const { messages } = state
      if (isIdle(messages)) {
        return yield* next(state)
      }

      // Every step pays for this check, so it reads only what the provider has not counted
      const before = contextTokens(messages, own.freshFrom)
      if (before <= maxTokens) {
        return yield* next(state)
      }

      const cut = cutIndex(messages, keepRecentTokens)
      if (!worthSummarizing(messages, cut)) {
        return yield* next(state)
      }

      yield { type: 'compaction:start', tokens: before }

      const deadline = timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs)
      const earlier = transcript(messages.slice(0, cut))
      const request = { model, systemPrompt: SUMMARIZE, messages: [user(earlier)] }
      let summary: string
      try {
        summary = textOf(yield* complete(request, { signal: deadline })).trim()
      } catch (error) {
        // A cancelled step ends the run as usual; anything else is only this compaction failing
        if (signal.aborted) {
          throw error
        }
        yield { type: 'compaction:end', before, after: before, error: messageOf(error) }
        return yield* next(state)
      }

      if (summary === '') {
        yield { type: 'compaction:end', before, after: before, error: 'The summary came back empty' }
        return yield* next(state)
      }

      const compacted = [user(`${SUMMARY_PREFIX}\n${summary}`), ...messages.slice(cut)]
      yield { type: 'compaction:end', before, after: estimateTokens(compacted) }
      return rewriteHistory(compacted)
    },
  })
}

/**
 * How many tokens the history takes. The last assistant message's usage is what the provider counted for everything up
 * to and including it; only what came after it is estimated. Usage from before the last rewrite counted a history that
 * is gone, so it is not used.
 */
export function contextTokens(messages: Message[], freshFrom = 0): number {
  for (let i = messages.length - 1; i >= freshFrom; i--) {
    const m = messages[i]
    if (m.role !== 'assistant') {
      continue
    }

    const { input, output, cacheRead, cacheWrite } = m.usage
    const counted = input + output + cacheRead + cacheWrite
    // Some providers report nothing; then it is all estimated
    if (counted > 0) {
      return counted + estimateTokens(messages, i + 1)
    }
    break
  }
  return estimateTokens(messages)
}

/** The estimate of messages[from..]: each message is counted once, then read from tokenCounts. */
export function estimateTokens(messages: Message[], from = 0): number {
  let tokens = 0
  for (let i = from; i < messages.length; i++) {
    tokens += tokensOf(messages[i])
  }
  return tokens
}

/**
 * Keeps the latest messages that fit in keepTokens, and at least the last one. The kept part never starts on a tool
 * result: providers reject one separated from the call that produced it, so the cut steps back to the assistant
 * message that made the calls.
 *
 *   index 0     1     2       3     4       5       6
 *   msgs  user  asst  result  asst  result  result  asst    5 and 6 fit in keepTokens, 4 does not
 *                             ^             ^
 *                             |             +-- the first that fits is 5, a toolResult
 *                             +---------------- step back past toolResults -> cut = 3
 *
 *   [0, cut) -> summarized        [cut, end) -> kept verbatim
 */
export function cutIndex(messages: Message[], keepTokens: number): number {
  let cut = messages.length
  let kept = 0
  while (cut > 0) {
    kept += tokensOf(messages[cut - 1])
    if (kept > keepTokens) {
      break
    }
    cut--
  }

  cut = Math.max(0, Math.min(cut, messages.length - 1))
  while (cut > 0 && messages[cut].role === 'toolResult') {
    cut--
  }
  return cut
}

/**
 * A message in the history is never changed, and every step's history holds the same message objects: counting each
 * one once keeps a long history from being scanned again on every step. Weak, so a finished session's messages are
 * freed with it.
 */
const tokenCounts = new WeakMap<Message, number>()

function tokensOf(m: Message): number {
  let tokens = tokenCounts.get(m)
  if (tokens === undefined) {
    tokens = countTokens(m)
    tokenCounts.set(m, tokens)
  }
  return tokens
}

/** ~4 ASCII characters per token, and a token for each other character: CJK text runs about one per character. */
function countTokens(m: Message): number {
  let ascii = 0
  let other = 0
  const count = (text: string): void => {
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i)
      if (code < 0x80) {
        ascii++
      } else if (code < LOW_SURROGATES[0] || code > LOW_SURROGATES[1]) {
        // The second half of a surrogate pair belongs to the character before it
        other++
      }
    }
  }

  let images = 0
  const content = typeof m.content === 'string' ? [{ type: 'text' as const, text: m.content }] : m.content
  for (const c of content) {
    switch (c.type) {
      case 'text':
        count(c.text)
        break
      case 'thinking':
        count(c.thinking)
        break
      case 'toolCall':
        count(c.name)
        count(JSON.stringify(c.arguments))
        break
      case 'image':
        images++
        break
    }
  }

  return Math.ceil(ascii / 4) + other + images * IMAGE_TOKENS
}

/** Something new to summarize: not nothing, and not only the summary of an earlier compaction. */
function worthSummarizing(messages: Message[], cut: number): boolean {
  return cut > 1 || (cut === 1 && !isSummary(messages[0]))
}

/** Empty, or ending on an assistant message without tool calls: no model call is coming. */
function isIdle(messages: Message[]): boolean {
  const last = messages.at(-1)
  return last === undefined || (last.role === 'assistant' && callsOf(last).length === 0)
}

function isSummary(m: Message): boolean {
  return m.role === 'user' && textOfUser(m).startsWith(SUMMARY_PREFIX)
}

function transcript(messages: Message[]): string {
  return messages.map(transcriptEntry).join('\n\n')
}

/** One message as the summarizer reads it: who said it, and what, with tool parts clipped. */
function transcriptEntry(m: Message): string {
  if (m.role === 'user') {
    return isSummary(m)
      ? `Earlier summary:\n${textOfUser(m).slice(SUMMARY_PREFIX.length + 1)}`
      : `User: ${textOfUser(m)}`
  }
  if (m.role === 'assistant') {
    const calls = callsOf(m).map(c => `-> ${c.name}(${clip(JSON.stringify(c.arguments))})`)
    return [`Assistant: ${textOf(m)}`, ...calls].join('\n')
  }

  const text = m.content.map(c => (c.type === 'text' ? c.text : `[${c.type}]`)).join('')
  return `Tool ${m.toolName}${m.isError ? ' (error)' : ''}: ${clip(text)}`
}

function clip(text: string): string {
  return text.length > TOOL_PART_CHARS ? `${text.slice(0, TOOL_PART_CHARS)} [...]` : text
}

function textOfUser(m: Message & { role: 'user' }): string {
  return typeof m.content === 'string'
    ? m.content
    : m.content.map(c => (c.type === 'text' ? c.text : `[${c.type}]`)).join('')
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
