import type { JsonObject } from '@earendil-works/pi-ai/compat'
// The choices plugin against pi-ai's faux provider, with tools that know nothing about it (RFC-0007 §5)
import type { Api, Model, Plugin, ToolResultMessage } from '@ji.dev/llm'
import type { Answer, Answers, ChoicesOptions, Question, Questions, Reply } from '../src/index.ts'
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from '@earendil-works/pi-ai/compat'
import { createAgent, createSession, tool, toolError, Type } from '@ji.dev/llm'
import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'
import { answerer, APPROVE, ask, ASK_USER, choices, DISMISSED, everyCall, named } from '../src/index.ts'

const REJECTED = 'The user rejected this call. Ask what they want instead.'

describe('approval, with choices', () => {
  it('should always ask about every call it is given, one at a time in call order, and run only the approved', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.record({ to: fc.stringMatching(/^[a-z]{1,6}$/), yes: fc.boolean() }), {
          selector: d => d.to,
          maxLength: 4,
        }),
        async deploys => {
          // Arrange: the person takes a while over each question
          const asked: string[] = []
          let open = 0
          let most = 0
          const answer: Answer = async ({ questions: [{ title }] }) => {
            most = Math.max(most, ++open)
            asked.push(title)
            await new Promise(resolve => setTimeout(resolve, 1))
            open--
            return pick(deploys.find(d => title === `Run deploy ${d.to}`)?.yes === true)
          }

          // Act
          const { results, ran } = await run(
            deploys.map(d => ['deploy', { to: d.to }]),
            { approve: [call => ({ title: `Run deploy ${String(call.arguments.to)}` })] },
            answer,
          )

          // Assert
          expect(asked).toEqual(deploys.map(d => `Run deploy ${d.to}`))
          expect(most).toBeLessThanOrEqual(1)
          expect(ran.toSorted()).toEqual(
            deploys
              .filter(d => d.yes)
              .map(d => `deploy ${d.to}`)
              .toSorted(),
          )
          expect(results.map(r => r.isError)).toEqual(deploys.map(d => !d.yes))
        },
      ),
      { numRuns: 30 },
    )
  })

  it('should run every call unasked by default', async () => {
    // Arrange
    let asked = 0

    // Act
    const { ran } = await run([['deploy', { to: 'prod' }]], {}, () => {
      asked++
      return pick(false)
    })

    // Assert
    expect(asked).toBe(0)
    expect(ran).toEqual(['deploy prod'])
  })

  it('should show everyCall as its name and arguments, with a yes or no and the call it is about', async () => {
    // Arrange
    const asked: Questions[] = []

    // Act
    await run([['deploy', { to: 'prod' }]], { approve: [everyCall] }, q => {
      asked.push(q)
      return pick(true)
    })

    // Assert
    expect(asked).toEqual([
      {
        type: 'ask:choices',
        questions: [{ title: 'Run deploy', detail: '{\n  "to": "prod"\n}', options: APPROVE, initial: undefined }],
        call: expect.objectContaining({ name: 'deploy', arguments: { to: 'prod' } }),
      },
    ])
  })

  it('should start the cursor on No when the proposal says so', async () => {
    // Arrange
    const initials: (string | undefined)[] = []

    // Act
    await run([['deploy', { to: 'prod' }]], { approve: [() => ({ title: 'Deploy', initial: 'no' })] }, q => {
      initials.push(q.questions[0].initial)
      return pick(true)
    })

    // Assert
    expect(initials).toEqual(['no'])
  })

  it('should not run a refused or dismissed call, and tell the model it was refused', async () => {
    for (const reply of [pick(false), DISMISSED] satisfies Reply[]) {
      // Act
      const { results, ran } = await run([['deploy', { to: 'prod' }]], { approve: [everyCall] }, () => reply)

      // Assert
      expect(results[0]).toMatchObject({ isError: true, content: [{ text: REJECTED }] })
      expect(ran).toEqual([])
    }
  })

  it('should let a call run unasked when no preview knows it', async () => {
    // Arrange
    const titles: string[] = []

    // Act
    const { results } = await run(
      [
        ['echo', { text: 'hi' }],
        ['deploy', { to: 'prod' }],
      ],
      { approve: [named('deploy')] },
      ({ questions: [{ title }] }) => {
        titles.push(title)
        return pick(false)
      },
    )

    // Assert
    expect(titles).toEqual(['Run deploy'])
    expect(results.map(r => r.isError)).toEqual([false, true])
  })

  it('should end a call with the result a preview returns, without asking or running it', async () => {
    // Arrange
    let asked = 0

    // Act
    const { results, ran } = await run(
      [['deploy', { to: 'prod' }]],
      { approve: [call => (call.arguments.to === 'prod' ? toolError(call, 'prod is frozen') : undefined), everyCall] },
      () => {
        asked++
        return pick(true)
      },
    )

    // Assert
    expect(asked).toBe(0)
    expect(results[0]).toMatchObject({ isError: true, content: [{ text: 'prod is frozen' }] })
    expect(ran).toEqual([])
  })

  it('should run the call the preview fixed, so what runs is what was shown', async () => {
    // Act
    const { ran } = await run(
      [['deploy', { to: 'latest' }]],
      { approve: [call => ({ title: 'Deploy v7', call: { ...call, arguments: { to: 'v7' } } })] },
      () => pick(true),
    )

    // Assert
    expect(ran).toEqual(['deploy v7'])
  })

  it('should end the call with an error when the reply is not one of the options', async () => {
    // Act
    const { results, ran } = await run([['deploy', { to: 'prod' }]], { approve: [everyCall] }, () => [['maybe']])

    // Assert
    expect(results[0]).toMatchObject({ isError: true, content: [{ text: '["maybe"] does not answer "Run deploy"' }] })
    expect(ran).toEqual([])
  })

  it('should wait at the question until the run is aborted when nobody answers (RFC-0007 §5.4)', async () => {
    // Arrange: no layer answers, so the run's own reply, undefined, reaches the question
    const ran: string[] = []
    const model = faux([calls(['deploy', { to: 'prod' }]), fauxAssistantMessage('done')])
    const r = createSession(createAgent({ model, tools: tools(ran), plugins: [nobody()] })).send('go')
    const stopped = new Error('stopped')

    // Act: the question reaches the reader, and nothing more happens until the abort
    const titles: string[] = []
    const reading = (async () => {
      for await (const e of r) {
        if (e.type === 'ask:choices') {
          titles.push(e.questions[0].title)
          setTimeout(() => r.abort(stopped), 5)
        }
      }
    })()

    // Assert
    await expect(reading).rejects.toMatchObject({ kind: 'aborted', cause: stopped })
    expect(titles).toEqual(['Run deploy'])
    expect(ran).toEqual([])
  })

  it('should stop the run without running the call when the run is aborted at the question', async () => {
    // Arrange
    const ran: string[] = []
    const model = faux([calls(['deploy', { to: 'prod' }]), fauxAssistantMessage('done')])
    const stopped = new Error('stopped')
    let abort = (): void => {}
    const asking = choices({
      approve: [everyCall],
      answer: () => {
        abort()
        return pick(true)
      },
    })

    // Act
    const r = createSession(createAgent({ model, tools: tools(ran), plugins: [asking] })).send('go')
    abort = () => r.abort(stopped)
    const state = r.state

    // Assert
    await expect(state).rejects.toMatchObject({ kind: 'aborted', cause: stopped })
    expect(ran).toEqual([])
  })
})

describe('ask_user', () => {
  const which: JsonObject = {
    question: 'Which database?',
    header: 'Storage',
    options: [{ label: 'Postgres (Recommended)', description: 'Runs as a service.' }, { label: 'SQLite' }],
  }
  const auth: JsonObject = {
    question: 'Which sign-ins?',
    header: 'Auth',
    options: [{ label: 'OAuth' }, { label: 'SSO' }],
    multiple: true,
  }

  it("should put the model's questions to the person, with Other, and give the model the answers", async () => {
    // Arrange
    const asked: Questions[] = []

    // Act
    const { results } = await run([[ASK_USER, { questions: [which, auth] }]], {}, q => {
      asked.push(q)
      return [['SQLite'], ['OAuth', 'Apple ID']]
    })

    // Assert
    expect(asked[0].questions).toEqual([
      {
        title: 'Which database?',
        header: 'Storage',
        options: [
          { value: 'Postgres (Recommended)', label: 'Postgres (Recommended)', hint: 'Runs as a service.' },
          { value: 'SQLite', label: 'SQLite', hint: undefined },
        ],
        multiple: undefined,
        other: true,
      },
      expect.objectContaining({ title: 'Which sign-ins?', multiple: true, other: true }),
    ])
    expect(results[0]).toMatchObject({
      isError: false,
      content: [{ text: 'Which database? SQLite\nWhich sign-ins? OAuth, Apple ID' }],
    })
  })

  it('should tell the model when the person dismisses the questions', async () => {
    // Act
    const { results } = await run([[ASK_USER, { questions: [which] }]], {}, () => DISMISSED)

    // Assert
    expect(results[0]).toMatchObject({
      isError: false,
      content: [{ text: 'The user dismissed the questions without answering. Ask what they want instead.' }],
    })
  })

  it('should never ask whether the model may ask', async () => {
    // Arrange
    const titles: string[] = []

    // Act
    await run([[ASK_USER, { questions: [which] }]], { approve: [everyCall] }, q => {
      titles.push(q.questions[0].title)
      return [['SQLite']]
    })

    // Assert
    expect(titles).toEqual(['Which database?'])
  })
})

describe('ask', () => {
  it('should always return a reply that answers every question, and throw on any other', async () => {
    const question = fc.record({
      options: fc.constantFrom<string[]>(['a', 'b'], ['a', 'b', 'c']),
      multiple: fc.boolean(),
      other: fc.boolean(),
    })
    const answer = fc.array(fc.constantFrom('a', 'b', 'c', 'typed'), { maxLength: 3 })

    await fc.assert(
      fc.asyncProperty(fc.array(fc.tuple(question, answer), { minLength: 1, maxLength: 3 }), async pairs => {
        // Arrange
        const questions = pairs.map(([q], i): Question => ({
          ...q,
          title: `q${i}`,
          options: q.options.map(v => ({ value: v, label: v })),
        }))
        const reply: Answers = pairs.map(([, a]) => a)
        const valid = pairs.every(
          ([q, a]) => (q.multiple || a.length === 1) && a.every(v => q.other || q.options.includes(v)),
        )

        // Act
        const asking = ask({ questions }, new AbortController().signal)
        await asking.next()
        const result = asking.next(reply)

        // Assert
        await (valid
          ? expect(result).resolves.toEqual({ done: true, value: reply })
          : expect(result).rejects.toThrow(TypeError))
      }),
      { numRuns: 200 },
    )
  })
})

describe('answerer', () => {
  it('should always let the answerer nearest the question answer first, and pass on what it leaves', async () => {
    await fc.assert(
      fc.asyncProperty(fc.subarray(['a', 'b', 'c', 'd'], { minLength: 1 }), async targets => {
        // Arrange: the inner answerer approves only a, and leaves the rest to the outer one, which refuses
        const inner = answerer({
          answer: ({ questions: [{ title }] }) => (title === 'Run deploy a' ? pick(true) : undefined),
        })
        const outer = choices({
          approve: [call => ({ title: `Run deploy ${String(call.arguments.to)}` })],
          answer: () => pick(false),
        })

        // Act: plugins earlier in the list are outer
        const { ran } = await runWith(
          targets.map(to => ['deploy', { to }]),
          [outer, inner],
        )

        // Assert
        expect(ran).toEqual(targets.includes('a') ? ['deploy a'] : [])
      }),
      { numRuns: 20 },
    )
  })

  it('should answer a question a tool asks itself, inside its tool_update (RFC-0007 §5.1)', async () => {
    // Arrange: a tool that asks before its irreversible step
    const ran: string[] = []
    const careful = tool({
      name: 'careful',
      description: 'Asks before acting.',
      parameters: Type.Object({}),
      async *run(_, signal) {
        const reply = yield* ask({ questions: [{ title: 'Really?', options: APPROVE }] }, signal)
        const yes = reply !== DISMISSED && reply[0][0] === 'yes'
        if (yes) {
          ran.push('careful')
        }
        return String(yes)
      },
    })
    const model = faux([calls(['careful', {}]), fauxAssistantMessage('done')])
    const answering = answerer({
      answer: ({ questions: [{ title }] }) => (title === 'Really?' ? pick(true) : undefined),
    })

    // Act
    const state = await createSession(createAgent({ model, tools: [careful], plugins: [answering] })).send('go').state

    // Assert
    expect(ran).toEqual(['careful'])
    expect(toolResults(state)[0]).toMatchObject({ isError: false, content: [{ text: 'true' }] })
  })
})

// Helpers

const registrations: { unregister: () => void }[] = []
afterEach(() => {
  registrations.splice(0).forEach(r => r.unregister())
})

type Calls = [name: string, args: JsonObject][]

/** The reply to one yes-or-no question. */
function pick(yes: boolean): Answers {
  return [[yes ? 'yes' : 'no']]
}

/** Asks about every call, and nobody inside the run answers. */
function nobody(): Plugin {
  return choices({ approve: [everyCall], answer: () => undefined })
}

function faux(responses: Parameters<ReturnType<typeof registerFauxProvider>['setResponses']>[0]): Model<Api> {
  const registration = registerFauxProvider()
  registration.setResponses(responses)
  registrations.push(registration)
  return registration.getModel()
}

/** One assistant message with these tool calls. */
function calls(...list: Calls): ReturnType<typeof fauxAssistantMessage> {
  return fauxAssistantMessage(
    list.map(([name, args]) => fauxToolCall(name, args)),
    { stopReason: 'toolUse' },
  )
}

/** deploy records what it ran; echo has no effect. */
function tools(ran: string[]): ReturnType<typeof tool>[] {
  return [
    tool({
      name: 'deploy',
      description: 'Deploy to a target.',
      parameters: Type.Object({ to: Type.String() }),
      run: ({ to }) => {
        ran.push(`deploy ${to}`)
        return `deployed to ${to}`
      },
    }),
    tool({
      name: 'echo',
      description: 'Return the text.',
      parameters: Type.Object({ text: Type.String() }),
      run: ({ text }) => text,
    }),
  ]
}

/** One model turn making these calls, with the choices plugin. */
function run(
  list: Calls,
  options: Omit<ChoicesOptions, 'answer'>,
  answer: Answer,
): Promise<{ results: ToolResultMessage[]; ran: string[] }> {
  return runWith(list, [choices({ ...options, answer })])
}

async function runWith(list: Calls, plugins: Plugin[]): Promise<{ results: ToolResultMessage[]; ran: string[] }> {
  const ran: string[] = []
  const model = faux([calls(...list), fauxAssistantMessage('done')])
  const state = await createSession(createAgent({ model, tools: tools(ran), plugins })).send('go').state
  return { results: toolResults(state), ran }
}

function toolResults(state: { messages: { role: string }[] }): ToolResultMessage[] {
  return state.messages.filter((m): m is ToolResultMessage => m.role === 'toolResult')
}
