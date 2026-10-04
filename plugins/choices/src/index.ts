// @ji.dev/plugin-choices: questions with fixed options, put to a person, with a reply to a yield (RFC-0007 §5)
//
//   createAgent({ model, plugins: [fileTools, choices({ answer: terminal(), approve: [fileTools.preview] })] })
//
//   choices    everything in one plugin: the ask_user tool the model asks with, a question before each call some
//              preview in `approve` proposes, and `answer` replying to every question asked inside it
//   answerer   only the replying, to stack policies: an inner answerer answers some questions and leaves the rest to
//              the outer one, so where it sits decides which questions it sees
//   ask        yields questions from a tool or a hook and returns the reply
//   Preview    what a call is about to do, before it runs. It is `intercept` with one more answer:
//                undefined            nothing to approve: the call runs, or the next preview looks at it
//                a tool result        the call ends with it, and nobody is asked
//                a Proposal           a person is asked, yes or no
//
// A question is a plain event: another plugin asks the same way by declaring 'ask:choices' itself, without importing
// this package (RFC-0005 §8.3). A tool asks by yielding the same event; it reaches the answerer inside a tool_update.
// @ji.dev/plugin-choices/terminal answers in a terminal.

import type { Payload, Plugin, Stream, ToolCall, ToolResultMessage } from '@ji.dev/llm'
import { definePlugin, tool, toolError, Type } from '@ji.dev/llm'

declare module '@ji.dev/llm' {
  interface Events {
    'ask:choices': Questions
  }
}

export interface Option {
  value: string
  label: string
  hint?: string
}

export interface Question {
  /** One line: what is being decided. */
  title: string
  /** A word or two, for its tab when several questions come at once. */
  header?: string
  /** The rest of what a person needs to decide: a diff, a command. */
  detail?: string
  options: Option[]
  /** Any number of options may be picked, none included. Default: exactly one. */
  multiple?: boolean
  /** The person may type an answer of their own instead. */
  other?: boolean
  /** The value of the option the cursor starts on. Default: the first. */
  initial?: string
}

/** Asked together, and answered together. */
export interface Questions {
  questions: Question[]
  /** The call they ask about, when they ask whether it may run. */
  call?: ToolCall
}

/** One list per question, in order: the values picked, and any text typed instead. */
export type Answers = string[][]

/** The person closed the questions without answering any. */
export const DISMISSED = 'dismissed'

export type Reply = Answers | typeof DISMISSED

/** A reply; undefined passes the questions on to the layers outside. */
export type Answer = (questions: Questions, signal: AbortSignal) => Reply | undefined | Promise<Reply | undefined>

export interface Proposal {
  title: string
  detail?: string
  /**
   * The call to run once approved, for a preview that fixes what it showed on the call, so that what runs is what was
   * approved. Left out, the previewed call runs as it is.
   */
  call?: ToolCall
  /** Where the cursor starts. Default 'yes'; 'no' for a call that should take a deliberate yes. */
  initial?: 'yes' | 'no'
}

export type Preview = (
  call: ToolCall,
  signal: AbortSignal,
) => Proposal | ToolResultMessage | undefined | Promise<Proposal | ToolResultMessage | undefined>

export interface ChoicesOptions {
  answer: Answer
  /**
   * Tried in order before each call; the first that returns anything decides, and a call none of them knows runs
   * unasked. Default: none, so only the model asks. [everyCall] asks about every call.
   */
  approve?: readonly Preview[]
}

export interface AnswererOptions {
  answer: Answer
  /** Default 'answerer'. Two answerers stacked need two names. */
  name?: string
}

export const APPROVE: Option[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
]

export const ASK_USER = 'ask_user'

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

/** The model's way to ask: it writes the options, and the person may always type an answer of their own. */
const askUser = tool({
  name: ASK_USER,
  description: [
    'Ask the user when you cannot go on without their decision and cannot work it out yourself.',
    'Put the option you recommend first and end its label with "(Recommended)".',
    'The user can always type an answer of their own instead of picking an option.',
  ].join(' '),
  parameters: Type.Object({
    questions: Type.Array(
      Type.Object({
        question: Type.String({ description: 'The whole question, ending with a question mark.' }),
        header: Type.String({ description: 'A word or two for its tab, at most 12 characters.' }),
        options: Type.Array(
          Type.Object({
            label: Type.String({ description: 'A few words.' }),
            description: Type.Optional(Type.String({ description: 'What picking it means.' })),
          }),
          { minItems: 2, maxItems: 4 },
        ),
        multiple: Type.Optional(Type.Boolean({ description: 'Several options may be picked.' })),
      }),
      { minItems: 1, maxItems: 4 },
    ),
  }),
  async *run({ questions }, signal) {
    const asked = questions.map((q): Question => ({
      title: q.question,
      header: q.header,
      options: q.options.map(o => ({ value: o.label, label: o.label, hint: o.description })),
      multiple: q.multiple,
      other: true,
    }))
    const reply = yield* ask({ questions: asked }, signal)

    if (reply === DISMISSED) {
      return 'The user dismissed the questions without answering. Ask what they want instead.'
    }
    return asked.map((q, i) => `${q.title} ${reply[i].length > 0 ? reply[i].join(', ') : '(none)'}`).join('\n')
  },
})

/**
 * The model asks with ask_user; `approve` asks before a call, and a refused call never runs: the model gets the
 * refusal as its result. `answer` replies to both, and to any question a tool or a plugin inside asks.
 */
export function choices({ answer, approve = [] }: ChoicesOptions): Plugin {
  return definePlugin({
    name: 'choices',
    tools: [askUser],
    async *toolCall(call, next, { signal }) {
      // Asking whether the model may ask would be a question about a question
      const preview = call.name === ASK_USER ? undefined : await firstOf(approve, call, signal)
      signal.throwIfAborted()

      if (preview === undefined) {
        return yield* next(call)
      }
      if (isResult(preview)) {
        return preview
      }

      const { title, detail, initial, call: approved = call } = preview
      const reply = yield* ask({ questions: [{ title, detail, options: APPROVE, initial }], call: approved }, signal)

      return reply !== DISMISSED && reply[0][0] === 'yes' ? yield* next(approved) : toolError(call, REJECTED)
    },
    ...answering(answer),
  })
}

/**
 * Questions come one at a time: while this layer waits for `answer`, nothing else inside it moves on (RFC-0007 §6.1).
 * toolCalls holds every tool and toolCall layer; decide holds decide and request.
 */
export function answerer({ answer, name = 'answerer' }: AnswererOptions): Plugin {
  return definePlugin({ name, ...answering(answer) })
}

/**
 * Yields the questions and returns the reply. With no layer answering, the run's own reply is undefined; that means
 * nobody can answer yet, so this waits until the step is cancelled (RFC-0007 §5.4).
 */
export async function* ask(questions: Questions, signal: AbortSignal): Stream<Payload, Reply> {
  const reply = yield { type: 'ask:choices', ...questions }
  if (reply === undefined) {
    await aborted(signal)
  }

  if (reply === DISMISSED) {
    return reply
  }
  if (!Array.isArray(reply) || reply.length !== questions.questions.length) {
    throw new TypeError(`${JSON.stringify(reply)} does not answer ${questions.questions.length} question(s)`)
  }
  questions.questions.forEach((question, i) => check(question, reply[i]))
  return reply as Answers
}

/** In a hook the questions are the event itself; from a tool they are the data of a tool_update. */
export function questionsOf(e: Payload): Questions | undefined {
  if (e.type === 'ask:choices') {
    return e
  }
  if (e.type === 'tool_update' && isQuestions(e.data)) {
    return e.data
  }
  return undefined
}

/** The hooks of a layer that replies to the questions inside it. */
function answering(answer: Answer): Pick<Plugin, 'toolCalls' | 'decide'> {
  return {
    toolCalls: (message, next, { signal }) => replying(next(message), answer, signal),
    decide: (state, next, { signal }) => replying(next(state), answer, signal),
  }
}

/** A reply from `answer` stops the event here; undefined lets it out and sends the outer reply back in (I15). */
async function* replying<T>(inner: Stream<Payload, T>, answer: Answer, signal: AbortSignal): Stream<Payload, T> {
  try {
    let r = await inner.next()
    while (!r.done) {
      const questions = questionsOf(r.value)
      const mine = questions === undefined ? undefined : await answer(questions, signal)
      signal.throwIfAborted()

      r = await inner.next(mine ?? (yield r.value))
    }
    return r.value
  } finally {
    await inner.return(undefined as never)
  }
}

/** One answer: one value for a single choice, any number for a multiple one, each an option unless `other` allows. */
function check(question: Question, answer: unknown): void {
  const values = new Set(question.options.map(o => o.value))
  const fits =
    Array.isArray(answer) &&
    (question.multiple === true || answer.length === 1) &&
    answer.every(a => typeof a === 'string' && (question.other === true || values.has(a)))

  if (!fits) {
    throw new TypeError(`${JSON.stringify(answer)} does not answer "${question.title}"`)
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

function isQuestions(data: unknown): data is { type: 'ask:choices' } & Questions {
  return typeof data === 'object' && data !== null && 'type' in data && data.type === 'ask:choices'
}

/** Never resolves; rejects with the abort reason. */
function aborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.throwIfAborted()
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
}
