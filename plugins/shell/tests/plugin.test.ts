// The plugins against pi-ai's faux provider: bash's place in a turn (L7, scenario 2.7) and approval with choices (L8)
import type { Api, AssistantMessage, JsonObject, Model, Plugin, ToolResultMessage } from '@ji.dev/llm'
import type { Answer } from '@ji.dev/plugin-choices'
import type { FakeReply } from '@ji.dev/testing'
import { createAgent, createSession } from '@ji.dev/llm'
import { choices } from '@ji.dev/plugin-choices'
import { files, memWorkspace } from '@ji.dev/plugin-files'
import { assistantMessage, createFakeModel, toolUse } from '@ji.dev/testing'
import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'
import { createMemoryExecutor, createSearchPlugin, createShellPlugin, splitAtBarriers } from '../src/index.ts'

describe('splitAtBarriers (L7)', () => {
  it('should cut the items so every barrier is alone, keep their order, and join all the rest that sit together', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom('edit', 'read', 'bash')), calls => {
        // Act
        const parts = splitAtBarriers(calls, call => call === 'bash')

        // Assert
        expect(parts.flat()).toEqual(calls)
        expect(parts.every(part => part.length > 0)).toBe(true)
        expect(parts.filter(part => part.includes('bash')).every(part => part.length === 1)).toBe(true)
        const together = parts.map(part => part[0] !== 'bash')
        expect(together.some((isGroup, i) => isGroup && together[i + 1])).toBe(false)
      }),
    )
  })
})

describe('createShellPlugin', () => {
  it('should run a command after the edits written before it in the same turn (scenario 2.7)', async () => {
    // Arrange: the command sees what is on disk when it starts
    const workspace = memWorkspace()
    const seen: (string | undefined)[] = []
    const executor = createMemoryExecutor(() => {
      seen.push(workspace.get('src/config.ts'), workspace.get('src/retry.ts'))
      return {}
    })
    const model = faux([
      calls(
        ['edit', { path: 'src/config.ts', content: 'timeout = 1\n' }],
        ['edit', { path: 'src/config.ts', edits: [{ old_text: '1', new_text: '2' }] }],
        ['edit', { path: 'src/retry.ts', content: 'retries = 3\n' }],
        ['bash', { command: 'pnpm test' }],
        ['grep', { pattern: 'timeout' }],
      ),
      assistantMessage('done'),
    ])

    // Act
    const search = createSearchPlugin(createMemoryExecutor(() => ({ exit: { kind: 'exit', code: 1 } })))
    const results = await resultsOf(model, [createShellPlugin(executor), search, files(workspace)])

    // Assert
    expect(seen).toEqual(['timeout = 2\n', 'retries = 3\n'])
    expect(results.map(r => r.toolName)).toEqual(['edit', 'edit', 'edit', 'bash', 'grep'])
    expect(results.slice(0, 4).every(r => !r.isError)).toBe(true)
  })

  it('should run only the command a person approved, exactly as shown, and ask about nothing else (L8)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), fc.boolean(), async (command, yes) => {
        // Arrange
        const executor = createMemoryExecutor(() => ({}))
        const shellPlugin = createShellPlugin(executor)
        const asked: (string | undefined)[] = []
        const answer: Answer = ({ questions: [{ title, detail }] }) => {
          asked.push(`${title}: ${detail}`)
          return [[yes ? 'yes' : 'no']]
        }
        const model = faux([calls(['grep', { pattern: 'x' }], ['bash', { command }]), assistantMessage('done')])

        // Act
        const results = await resultsOf(model, [
          shellPlugin,
          createSearchPlugin(executor),
          choices({ answer, approve: [shellPlugin.preview] }),
        ])

        // Assert
        expect(asked).toEqual([`Run command: ${command}`])
        expect(executor.commands.filter(c => typeof c === 'string')).toEqual(yes ? [command] : [])
        expect(results.find(r => r.toolName === 'bash')?.isError).toBe(!yes)
      }),
      { numRuns: 20 },
    )
  })

  it('should neither ask about nor run a command that is not a string (X11)', async () => {
    // Arrange
    const executor = createMemoryExecutor(() => ({}))
    const shellPlugin = createShellPlugin(executor)
    let asked = 0
    const answer: Answer = () => {
      asked++
      return [['yes']]
    }
    const model = faux([calls(['bash', { command: ['rm', '-rf', '/'] }]), assistantMessage('done')])

    // Act
    const [result] = await resultsOf(model, [shellPlugin, choices({ answer, approve: [shellPlugin.preview] })])

    // Assert
    expect(asked).toBe(0)
    expect(executor.commands).toEqual([])
    expect(result).toMatchObject({ isError: true, content: [{ text: 'command must be a string.' }] })
  })
})

// Helpers

const registrations: { dispose: () => void }[] = []
afterEach(() => {
  registrations.splice(0).forEach(r => r.dispose())
})

function faux(responses: FakeReply[]): Model<Api> {
  const fake = createFakeModel(responses)
  registrations.push(fake)
  return fake.model
}

/** One assistant message with these tool calls. */
function calls(...list: [name: string, args: JsonObject][]): AssistantMessage {
  return assistantMessage(list.map(([name, args]) => toolUse(name, args)))
}

async function resultsOf(model: Model<Api>, plugins: Plugin<any>[]): Promise<ToolResultMessage[]> {
  const state = await createSession(createAgent({ model, plugins })).send('go').state
  return state.messages.filter((m): m is ToolResultMessage => m.role === 'toolResult')
}
