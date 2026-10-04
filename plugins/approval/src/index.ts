// @ji.dev/plugin-approval: asks a person before a tool call runs, with a reply to a yield (RFC-0007 §5)
//
//   createAgent({ model, plugins: [fileTools, approval({ previews: [fileTools.preview] }), answerer({ answer })] })
//
//   approval   the asker: a toolCall layer that yields an 'ask:choice' event before a call some preview proposes;
//              the reply to that yield is the choice, and only 'yes' lets the call run
//   answerer   the answerer: a toolCalls and decide layer that replies to the questions of the layers inside it, so
//              where it sits decides which questions it sees, not who imports whom
//   Preview    what a call is about to do, before it runs. It is `intercept` with one more answer:
//                undefined            nothing to approve: the call runs, or the next preview looks at it
//                a tool result        the call ends with it, and nobody is asked
//                a Proposal           a person is asked
//
// A question is a plain event: another plugin asks the same way by declaring 'ask:choice' itself, without importing
// this package (RFC-0005 §8.3). A tool asks by yielding the same event; it reaches the answerer inside a tool_update.

import type { Payload, Plugin, Stream, ToolCall, ToolResultMessage } from '@ji.dev/llm'
import { definePlugin, toolError } from '@ji.dev/llm'

declare module '@ji.dev/llm' {
  interface Events {
    'ask:choice': ChoiceQuestion
  }
}

export interface Choice {
  value: string
  label: string
  hint?: string
}

/** A question with a fixed set of answers; the reply to it is the value of one of `choices`. */
export interface ChoiceQuestion {
  /** One line: what is being decided. */
  title: string
  /** The rest of what a person needs to decide: a diff, a command. */
  detail?: string
  choices: Choice[]
}

export interface Proposal {
  title: string
  detail?: string
  /**
   * The call to run once approved, for a preview that fixes what it showed on the call, so that what runs is what was
   * approved. Left out, the previewed call runs as it is.
   */
  call?: ToolCall
}

export type Preview = (
  call: ToolCall,
  signal: AbortSignal,
) => Proposal | ToolResultMessage | undefined | Promise<Proposal | ToolResultMessage | undefined>

export interface ApprovalOptions {
  /**
   * Tried in order; the first that returns anything decides, and a call none of them knows runs unasked.
   * Default: [everyCall], so every call is asked about.
   */
  previews?: readonly Preview[]
}

/** A choice value; undefined passes the question on to the layers outside. */
export type Answer = (question: ChoiceQuestion, signal: AbortSignal) => string | undefined | Promise<string | undefined>

export interface AnswererOptions {
  answer: Answer
  /** Default 'answerer'. Two answerers stacked, the inner one answering only some questions, need two names. */
  name?: string
}

export const APPROVE: Choice[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
]

const REJECTED = 'The user rejected this call. Ask what they want instead.'

/** Every call, shown as its name and arguments. */
export const everyCall: Preview = call => ({
  title: `Run ${call.name}`,
  detail: JSON.stringify(call.arguments, null, 2),
})

/** The calls of these tools, shown like everyCall: for tools whose plugin has no preview of its own. */
export function named(...names: string[]): Preview {
  return (call, signal) => (names.includes(call.name) ? everyCall(call, signal) : undefined)
}

/** A refused call never runs; the model gets the refusal as the call's result. */
export function approval({ previews = [everyCall] }: ApprovalOptions = {}): Plugin {
  return definePlugin({
    name: 'approval',
    async *toolCall(call, next, { signal }) {
      const preview = await firstOf(previews, call, signal)
      signal.throwIfAborted()

      if (preview === undefined) {
        return yield* next(call)
      }
      if (isResult(preview)) {
        return preview
      }

      const { title, detail, call: approved = call } = preview
      const choice = yield* ask({ title, detail, choices: APPROVE }, signal)

      return choice === 'yes' ? yield* next(approved) : toolError(call, REJECTED)
    },
  })
}

/**
 * Yields the question and returns the choice. With no layer answering, the run's own reply is undefined; that means
 * nobody can answer yet, so this waits until the step is cancelled (RFC-0007 §5.4).
 */
export async function* ask(question: ChoiceQuestion, signal: AbortSignal): Stream<Payload, string> {
  const reply = yield { type: 'ask:choice', ...question }
  if (reply === undefined) {
    await aborted(signal)
  }

  const choice = question.choices.find(c => c.value === reply)
  if (choice === undefined) {
    throw new TypeError(`"${String(reply)}" is not a choice of "${question.title}"`)
  }
  return choice.value
}

/**
 * Questions come one at a time: while this layer waits for `answer`, nothing else inside it moves on (RFC-0007 §6.1).
 * toolCalls holds every tool and toolCall layer; decide holds decide and request.
 */
export function answerer({ answer, name = 'answerer' }: AnswererOptions): Plugin {
  return definePlugin({
    name,
    toolCalls: (message, next, { signal }) => answering(next(message), answer, signal),
    decide: (state, next, { signal }) => answering(next(state), answer, signal),
  })
}

/** In a hook the question is the event itself; from a tool it is the data of a tool_update. */
export function questionOf(e: Payload): ChoiceQuestion | undefined {
  if (e.type === 'ask:choice') {
    return e
  }
  if (e.type === 'tool_update' && isQuestion(e.data)) {
    return e.data
  }
  return undefined
}

/** A reply from `answer` stops the event here; undefined lets it out and sends the outer reply back in (I15). */
async function* answering<T>(inner: Stream<Payload, T>, answer: Answer, signal: AbortSignal): Stream<Payload, T> {
  try {
    let r = await inner.next()
    while (!r.done) {
      const question = questionOf(r.value)
      const mine = question === undefined ? undefined : await answer(question, signal)
      signal.throwIfAborted()

      r = await inner.next(mine !== undefined ? mine : yield r.value)
    }
    return r.value
  } finally {
    await inner.return(undefined as never)
  }
}

async function firstOf(
  previews: readonly Preview[],
  call: ToolCall,
  signal: AbortSignal,
): Promise<Proposal | ToolResultMessage | undefined> {
  for (const preview of previews) {
    const found = await preview(call, signal)
    if (found !== undefined) {
      return found
    }
  }
  return undefined
}

function isResult(preview: Proposal | ToolResultMessage): preview is ToolResultMessage {
  return 'role' in preview
}

function isQuestion(data: unknown): data is { type: 'ask:choice' } & ChoiceQuestion {
  return typeof data === 'object' && data !== null && 'type' in data && data.type === 'ask:choice'
}

/** Never resolves; rejects with the abort reason. */
function aborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.throwIfAborted()
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
}
