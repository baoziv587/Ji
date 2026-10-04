// The approval plugin against pi-ai's faux provider, with tools that know nothing about it
import type { Api, Model, ToolResultMessage } from '@ji.dev/llm'
import type { ApprovalOptions, Question } from '../src/index.ts'
import { createAgent, createSession, tool, toolError, Type } from '@ji.dev/llm'
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from '@mariozechner/pi-ai'
import { afterEach, describe, expect, it } from 'vitest'
import { approval, everyCall, named } from '../src/index.ts'

describe('approval', () => {
  it('should ask about every call by default, showing its name and arguments, and run it once approved', async () => {
    // Arrange
    const asked: Pick<Question, 'title' | 'detail'>[] = []

    // Act
    const { results, ran } = await run([['deploy', { to: 'prod' }]], {
      ask: ({ title, detail }) => {
        asked.push({ title, detail })
        return true
      },
    })

    // Assert
    expect(asked).toEqual([{ title: 'Run deploy', detail: '{\n  "to": "prod"\n}' }])
    expect(results[0]).toMatchObject({ isError: false, content: [{ text: 'deployed to prod' }] })
    expect(ran).toEqual(['deploy prod'])
  })

  it('should not run a refused call, and tell the model what the person said', async () => {
    // Act
    const silent = await run([['deploy', { to: 'prod' }]], { ask: () => false })
    const spoken = await run([['deploy', { to: 'prod' }]], { ask: () => 'Deploy to staging first.' })

    // Assert
    expect(silent.results[0]).toMatchObject({ isError: true, content: [{ text: 'The user rejected this call.' }] })
    expect(spoken.results[0]).toMatchObject({ isError: true, content: [{ text: 'Deploy to staging first.' }] })
    expect([...silent.ran, ...spoken.ran]).toEqual([])
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
      {
        ask: ({ title }) => {
          titles.push(title)
          return false
        },
        previews: [named('deploy')],
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
    const { results, ran } = await run([['deploy', { to: 'prod' }]], {
      ask: () => {
        asked++
        return true
      },
      previews: [call => (call.arguments.to === 'prod' ? toolError(call, 'prod is frozen') : undefined), everyCall],
    })

    // Assert
    expect(asked).toBe(0)
    expect(results[0]).toMatchObject({ isError: true, content: [{ text: 'prod is frozen' }] })
    expect(ran).toEqual([])
  })

  it('should run the call the preview fixed, so what runs is what was shown', async () => {
    // Arrange: the preview resolves "latest" once, and the call that runs carries the version it showed
    const shown: string[] = []

    // Act
    const { ran } = await run([['deploy', { to: 'latest' }]], {
      ask: ({ title, call }) => {
        shown.push(`${title} | ${JSON.stringify(call.arguments)}`)
        return true
      },
      previews: [call => ({ title: 'Deploy v7', call: { ...call, arguments: { to: 'v7' } } })],
    })

    // Assert
    expect(shown).toEqual(['Deploy v7 | {"to":"v7"}'])
    expect(ran).toEqual(['deploy v7'])
  })

  it('should ask one question at a time when the calls of a turn run at once', async () => {
    // Arrange
    let open = 0
    let most = 0
    const order: string[] = []

    // Act
    const { ran } = await run(
      [
        ['deploy', { to: 'a' }],
        ['deploy', { to: 'b' }],
        ['deploy', { to: 'c' }],
      ],
      {
        ask: async ({ call }) => {
          most = Math.max(most, ++open)
          order.push(String(call.arguments.to))
          await new Promise(resolve => setTimeout(resolve, 5))
          open--
          return call.arguments.to !== 'b'
        },
      },
    )

    // Assert
    expect(most).toBe(1)
    expect(order).toEqual(['a', 'b', 'c'])
    expect(ran.toSorted()).toEqual(['deploy a', 'deploy c'])
  })

  it('should stop the run without running the call when the run is aborted at the question', async () => {
    // Arrange
    const ran: string[] = []
    const model = faux([calls(['deploy', { to: 'prod' }]), fauxAssistantMessage('done')])
    const stopped = new Error('stopped')
    let abort = (): void => {}
    const plugin = approval({
      ask: () => {
        abort()
        return true
      },
    })

    // Act
    const r = createSession(createAgent({ model, tools: tools(ran), plugins: [plugin] })).send('go')
    abort = () => r.abort(stopped)
    const state = r.state

    // Assert
    await expect(state).rejects.toMatchObject({ kind: 'aborted', cause: stopped })
    expect(ran).toEqual([])
  })
})

// Helpers

const registrations: { unregister: () => void }[] = []
afterEach(() => {
  registrations.splice(0).forEach(r => r.unregister())
})

function faux(responses: Parameters<ReturnType<typeof registerFauxProvider>['setResponses']>[0]): Model<Api> {
  const registration = registerFauxProvider()
  registration.setResponses(responses)
  registrations.push(registration)
  return registration.getModel()
}

/** One assistant message with these tool calls. */
function calls(...list: [name: string, args: Record<string, unknown>][]): ReturnType<typeof fauxAssistantMessage> {
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

/** One model turn making these calls, with the approval plugin. */
async function run(
  list: [name: string, args: Record<string, unknown>][],
  options: ApprovalOptions,
): Promise<{ results: ToolResultMessage[]; ran: string[] }> {
  const ran: string[] = []
  const model = faux([calls(...list), fauxAssistantMessage('done')])
  const agent = createAgent({ model, tools: tools(ran), plugins: [approval(options)] })
  const state = await createSession(agent).send('go').state
  return { results: state.messages.filter((m): m is ToolResultMessage => m.role === 'toolResult'), ran }
}
