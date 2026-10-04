// The files plugin against pi-ai's faux provider: the scenarios of RFC §2, as the model sees them
import type { AgentState, Api, Model, ToolResultMessage } from '@ji.dev/llm'
import type { FauxResponseStep } from '@mariozechner/pi-ai'
import type { FilesOptions, MemWorkspace } from '../src/index.ts'
import { posix } from 'node:path'
import { createAgent, createSession, Type } from '@ji.dev/llm'
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from '@mariozechner/pi-ai'
import { afterEach, describe, expect, it } from 'vitest'
import { editTool, files, fileTool, memWorkspace, ok } from '../src/index.ts'

const CONFIG = 'const timeout = 1000;\nconst retries = 2;\n'

describe('files', () => {
  it('should let the model read a file, then change two places in one call (scenario 2.2)', async () => {
    // Arrange
    const workspace = rooted({ '/w/src/config.ts': CONFIG })
    const model = faux([
      calls(['read', { path: 'src/config.ts' }]),
      calls([
        'edit',
        {
          path: 'src/config.ts',
          edits: [
            { old_text: 'const timeout = 1000;', new_text: 'const timeout = 2000;' },
            { old_text: 'const retries = 2;', new_text: 'const retries = 3;' },
          ],
        },
      ]),
      fauxAssistantMessage('done'),
    ])

    // Act
    const results = await resultsOf(workspace, model)

    // Assert
    expect(results[0]).toMatchObject({ isError: false, content: [{ text: CONFIG }] })
    expect(text(results[1])).toMatch(/^Edited src\/config\.ts \(\+2 -2\)\./)
    expect(workspace.get('/w/src/config.ts')).toBe('const timeout = 2000;\nconst retries = 3;\n')
  })

  it('should refuse an edit of a file the model has not read, whatever version it makes up', async () => {
    // Arrange
    const workspace = rooted({ '/w/a.ts': 'one' })
    const model = faux([
      calls(['edit', { path: 'a.ts', edits: [{ old_text: 'one', new_text: 'two' }], expected_version: 'm1' }]),
      fauxAssistantMessage('done'),
    ])

    // Act
    const [result] = await resultsOf(workspace, model)

    // Assert
    expect(result).toMatchObject({
      isError: true,
      details: { errors: [{ code: 'STALE_VERSION', expected: 'absent' }] },
    })
    expect(text(result)).toContain('a.ts exists and you have not read it.')
    expect(workspace.get('/w/a.ts')).toBe('one')
  })

  it('should reject an edit after the user changed the file in an editor (scenario 2.6)', async () => {
    // Arrange
    const workspace = rooted({ '/w/src/app.ts': 'run()\n' })
    const model = faux([
      calls(['read', { path: 'src/app.ts' }]),
      () => {
        workspace.set('/w/src/app.ts', 'import x from "x"\nrun()\n')
        return calls(['edit', { path: 'src/app.ts', edits: [{ old_text: 'run()', new_text: 'start()' }] }])
      },
      fauxAssistantMessage('done'),
    ])

    // Act
    const results = await resultsOf(workspace, model)

    // Assert
    expect(text(results[1])).toMatch(
      /^Edit failed; src\/app\.ts is unchanged\.\nThe file is not at the version you last read/,
    )
    expect(workspace.get('/w/src/app.ts')).toBe('import x from "x"\nrun()\n')
  })

  it('should run two edits of one file in one step in order, the second on top of the first (scenario 2.7)', async () => {
    // Arrange
    const workspace = rooted({ '/w/src/a.ts': 'import { x } from "./x"\nexport function run() {}\n', '/w/b.ts': 'b' })
    const model = faux([
      calls(['read', { path: 'src/a.ts' }]),
      calls(
        ['edit', { path: 'src/a.ts', edits: [{ old_text: 'import { x }', new_text: 'import { x, y }' }] }],
        ['read', { path: 'b.ts' }],
        [
          'edit',
          { path: './src/a.ts', edits: [{ old_text: 'export function run()', new_text: 'export function start()' }] },
        ],
      ),
      fauxAssistantMessage('done'),
    ])

    // Act
    const results = await resultsOf(workspace, model)

    // Assert
    expect(results.map(r => r.isError)).toEqual([false, false, false, false])
    expect(workspace.get('/w/src/a.ts')).toBe('import { x, y } from "./x"\nexport function start() {}\n')
  })

  it('should know a file the model read under another name: the ledger keys on identity, not spelling (E8)', async () => {
    // Arrange
    const workspace = rooted({ '/w/src/a.ts': 'one\n' })
    const model = faux([
      calls(['read', { path: 'link/a.ts' }]),
      calls(
        ['edit', { path: '/w/src/a.ts', edits: [{ old_text: 'one', new_text: 'two' }] }],
        ['edit', { path: 'link/a.ts', edits: [{ old_text: 'two', new_text: 'three' }] }],
      ),
      fauxAssistantMessage('done'),
    ])

    // Act
    const results = await resultsOf(workspace, model)

    // Assert
    expect(results.map(r => r.isError)).toEqual([false, false, false])
    expect(workspace.get('/w/src/a.ts')).toBe('three\n')
  })

  it('should create a new file with content, and refuse to overwrite one the model has not read', async () => {
    // Arrange
    const workspace = rooted({ '/w/a.ts': 'keep me' })
    const model = faux([
      calls(['edit', { path: 'new.ts', content: 'export {}\n' }], ['edit', { path: 'a.ts', content: 'gone' }]),
      fauxAssistantMessage('done'),
    ])

    // Act
    const results = await resultsOf(workspace, model)

    // Assert
    expect(text(results[0])).toBe('Created new.ts (1 line).')
    expect(text(results[1])).toContain('a.ts exists and you have not read it.')
    expect(workspace.get('/w/a.ts')).toBe('keep me')
  })

  it('should keep the ledger in session state, so rolling the session back rolls it back too (scenario 2.9)', async () => {
    // Arrange
    const workspace = rooted({ '/w/a.ts': 'one\n' })
    const model = faux([
      calls(['read', { path: 'a.ts' }]),
      fauxAssistantMessage('read it'),
      calls(['edit', { path: 'a.ts', edits: [{ old_text: 'one', new_text: 'two' }] }]),
      fauxAssistantMessage('edited'),
      calls(['edit', { path: 'a.ts', edits: [{ old_text: 'one', new_text: 'three' }] }]),
      fauxAssistantMessage('tried'),
    ])
    const plugin = files(workspace)
    const agent = createAgent({ model, plugins: [plugin] })
    const chat = createSession(agent)
    await chat.send('read a.ts').result
    const beforeEdit: AgentState = chat.state
    await chat.send('edit it').result

    // Act
    const rolledBack = createSession(agent, { state: beforeEdit })
    const after = await rolledBack.send('edit it differently').state

    // Assert
    expect(plugin.select(beforeEdit).versions['/w/a.ts']).toBeDefined()
    expect(workspace.get('/w/a.ts')).toBe('two\n')
    expect(text(toolResults(after).at(-1)!)).toContain('The file is not at the version you last read')
  })
})

describe('hints', () => {
  const GO = 'func f() error {\n\tif err != nil {\n\t\treturn err\n\t}\n}\n'
  const wrongIndent = [
    calls(['read', { path: 'server.go' }]),
    calls(['edit', { path: 'server.go', edits: [{ old_text: '    return err', new_text: '    return wrap(err)' }] }]),
    fauxAssistantMessage('done'),
  ]

  it('should show where similar text is when old_text is not found, without applying it (scenario 2.5)', async () => {
    // Arrange
    const workspace = rooted({ '/w/server.go': GO })

    // Act
    const results = await resultsOf(workspace, faux(wrongIndent))

    // Assert
    expect(results[1].isError).toBe(true)
    expect(text(results[1])).toContain(
      'Similar text (not applied):\n  edits[0], line 3: differs only in indentation or trailing spaces\nRead those lines and copy them exactly.',
    )
    expect(workspace.get('/w/server.go')).toBe(GO)
  })

  it('should leave the hints out for an edit tool made without hinters', async () => {
    // Arrange
    const workspace = rooted({ '/w/server.go': GO })

    // Act
    const results = await resultsOf(workspace, faux(wrongIndent), { tools: [editTool({ hinters: [] })] })

    // Assert
    expect(text(results[1])).toContain('old_text not found')
    expect(text(results[1])).not.toContain('Similar text')
  })
})

describe('fileTool', () => {
  const append = fileTool({
    name: 'append',
    description: 'Add text to the end of a file.',
    parameters: Type.Object({ path: Type.String(), text: Type.String() }),
    transform:
      ({ text: added }) =>
      current =>
        ok(current + added),
  })

  it('should give a tool made from a transform the same version check and ledger as edit', async () => {
    // Arrange
    const workspace = rooted({ '/w/log.txt': 'one\n' })
    const model = faux([
      calls(['append', { path: 'log.txt', text: 'unread\n' }]),
      calls(['read', { path: 'log.txt' }]),
      calls(['append', { path: 'log.txt', text: 'two\n' }]),
      calls(['edit', { path: 'log.txt', edits: [{ old_text: 'two', new_text: 'three' }] }]),
      fauxAssistantMessage('done'),
    ])

    // Act
    const results = await resultsOf(workspace, model, { tools: [editTool(), append] })

    // Assert
    expect(results.map(r => r.isError)).toEqual([true, false, false, false])
    expect(text(results[0])).toContain('log.txt exists and you have not read it.')
    expect(text(results[2])).toMatch(/^Edited log\.txt \(\+1 -0\)\.\n@@.*@@\n\+two$/)
    expect(workspace.get('/w/log.txt')).toBe('one\nthree\n')
  })
})

// Helpers

const registrations: { unregister: () => void }[] = []
afterEach(() => {
  registrations.splice(0).forEach(r => r.unregister())
})

function faux(responses: FauxResponseStep[]): Model<Api> {
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

/** A workspace whose relative paths resolve against /w, with /w/link an alias of /w/src. */
function rooted(initial: Record<string, string>): MemWorkspace {
  return memWorkspace(initial, path => posix.resolve('/w', path).replace(/^\/w\/link\//, '/w/src/'))
}

async function resultsOf(
  workspace: MemWorkspace,
  model: Model<Api>,
  options?: FilesOptions,
): Promise<ToolResultMessage[]> {
  const state = await createSession(createAgent({ model, plugins: [files(workspace, options)] })).send('go').state
  return toolResults(state)
}

function toolResults(state: AgentState): ToolResultMessage[] {
  return state.messages.filter((m): m is ToolResultMessage => m.role === 'toolResult')
}

function text(result: ToolResultMessage): string {
  return result.content.map(c => (c.type === 'text' ? c.text : '')).join('\n')
}
