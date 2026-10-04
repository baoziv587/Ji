// The approval plugin against pi-ai's faux provider, with tools that know nothing about it (RFC-0007 §5)
import type { Api, Model, Plugin, ToolResultMessage } from '@ji.dev/llm'
import type { Answer, ApprovalOptions, ChoiceQuestion } from '../src/index.ts'
import { createAgent, createSession, tool, toolError, Type } from '@ji.dev/llm'
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from '@mariozechner/pi-ai'
import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'
import { answerer, approval, APPROVE, ask, everyCall, named } from '../src/index.ts'

const REJECTED = 'The user rejected this call. Ask what they want instead.'

describe('approval', () => {
  it('should always ask about every call by default, one at a time in call order, and run only the approved', async () => {
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
          const answer: Answer = async ({ title }) => {
            most = Math.max(most, ++open)
            asked.push(title)
            await new Promise(resolve => setTimeout(resolve, 1))
            open--
            return deploys.find(d => title === `Run deploy ${d.to}`)?.yes === true ? 'yes' : 'no'
          }

          // Act
          const { results, ran } = await run(
            deploys.map(d => ['deploy', { to: d.to }]),
            { previews: [call => ({ title: `Run deploy ${String(call.arguments.to)}` })] },
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

  it('should show a call as its name and arguments by default, with a yes or no to choose', async () => {
    // Arrange
    const asked: ChoiceQuestion[] = []

    // Act
    await run([['deploy', { to: 'prod' }]], {}, q => {
      asked.push(q)
      return 'yes'
    })

    // Assert
    expect(asked).toEqual([
      { type: 'ask:choice', title: 'Run deploy', detail: '{\n  "to": "prod"\n}', choices: APPROVE },
    ])
  })

  it('should not run a refused call, and tell the model it was refused', async () => {
    // Act
    const { results, ran } = await run([['deploy', { to: 'prod' }]], {}, () => 'no')

    // Assert
    expect(results[0]).toMatchObject({ isError: true, content: [{ text: REJECTED }] })
    expect(ran).toEqual([])
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
      { previews: [named('deploy')] },
      ({ title }) => {
        titles.push(title)
        return 'no'
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
      { previews: [call => (call.arguments.to === 'prod' ? toolError(call, 'prod is frozen') : undefined), everyCall] },
      () => {
        asked++
        return 'yes'
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
      { previews: [call => ({ title: 'Deploy v7', call: { ...call, arguments: { to: 'v7' } } })] },
      () => 'yes',
    )

    // Assert
    expect(ran).toEqual(['deploy v7'])
  })

  it('should end the call with an error when the reply is not one of the choices', async () => {
    // Act
    const { results, ran } = await run([['deploy', { to: 'prod' }]], {}, () => 'maybe')

    // Assert
    expect(results[0]).toMatchObject({ isError: true, content: [{ text: '"maybe" is not a choice of "Run deploy"' }] })
    expect(ran).toEqual([])
  })

  it('should wait at the question until the run is aborted when nobody answers (RFC-0007 §5.4)', async () => {
    // Arrange: no answerer, so the run's own reply, undefined, reaches the question
    const ran: string[] = []
    const model = faux([calls(['deploy', { to: 'prod' }]), fauxAssistantMessage('done')])
    const r = createSession(createAgent({ model, tools: tools(ran), plugins: [approval()] })).send('go')
    const stopped = new Error('stopped')

    // Act: the question reaches the reader, and nothing more happens until the abort
    const questions: string[] = []
    const reading = (async () => {
      for await (const e of r) {
        if (e.type === 'ask:choice') {
          questions.push(e.title)
          setTimeout(() => r.abort(stopped), 5)
        }
      }
    })()

    // Assert
    await expect(reading).rejects.toMatchObject({ kind: 'aborted', cause: stopped })
    expect(questions).toEqual(['Run deploy'])
    expect(ran).toEqual([])
  })

  it('should stop the run without running the call when the run is aborted at the question', async () => {
    // Arrange
    const ran: string[] = []
    const model = faux([calls(['deploy', { to: 'prod' }]), fauxAssistantMessage('done')])
    const stopped = new Error('stopped')
    let abort = (): void => {}
    const answering = answerer({
      answer: () => {
        abort()
        return 'yes'
      },
    })

    // Act
    const r = createSession(createAgent({ model, tools: tools(ran), plugins: [approval(), answering] })).send('go')
    abort = () => r.abort(stopped)
    const state = r.state

    // Assert
    await expect(state).rejects.toMatchObject({ kind: 'aborted', cause: stopped })
    expect(ran).toEqual([])
  })
})

describe('answerer', () => {
  it('should always let the answerer nearest the question answer first, and pass on what it leaves', async () => {
    await fc.assert(
      fc.asyncProperty(fc.subarray(['a', 'b', 'c', 'd'], { minLength: 1 }), async targets => {
        // Arrange: the inner answerer approves only a, and leaves the rest to the outer one, which refuses
        const inner = answerer({
          name: 'approve-a',
          answer: ({ title }) => (title === 'Run deploy a' ? 'yes' : undefined),
        })
        const outer = answerer({ name: 'refuse', answer: () => 'no' })
        const previews = [
          call => ({ title: `Run deploy ${String(call.arguments.to)}` }),
        ] satisfies ApprovalOptions['previews']

        // Act: plugins earlier in the list are outer
        const { ran } = await runWith(
          targets.map(to => ['deploy', { to }]),
          [approval({ previews }), outer, inner],
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
        const choice = yield* ask({ title: 'Really?', choices: APPROVE }, signal)
        if (choice === 'yes') {
          ran.push('careful')
        }
        return choice
      },
    })
    const model = faux([calls(['careful', {}]), fauxAssistantMessage('done')])
    const answering = answerer({ answer: ({ title }) => (title === 'Really?' ? 'yes' : undefined) })

    // Act
    const state = await createSession(createAgent({ model, tools: [careful], plugins: [answering] })).send('go').state

    // Assert
    expect(ran).toEqual(['careful'])
    expect(toolResults(state)[0]).toMatchObject({ isError: false, content: [{ text: 'yes' }] })
  })
})

// Helpers

const registrations: { unregister: () => void }[] = []
afterEach(() => {
  registrations.splice(0).forEach(r => r.unregister())
})

type Calls = [name: string, args: Record<string, unknown>][]

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

/** One model turn making these calls, with the approval plugin and an answerer. */
function run(
  list: Calls,
  options: ApprovalOptions,
  answer: Answer,
): Promise<{ results: ToolResultMessage[]; ran: string[] }> {
  return runWith(list, [approval(options), answerer({ answer })])
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
