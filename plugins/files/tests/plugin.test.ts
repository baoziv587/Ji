import type { FauxResponseStep, JsonObject } from '@earendil-works/pi-ai/compat'
// The files plugin against pi-ai's faux provider: the scenarios of RFC §2, as the model sees them
import type { AgentState, Api, Model, Plugin, ToolResultMessage } from '@ji.dev/llm'
import type { ChangePreview, FilesOptions, FilesPlugin, MemWorkspace } from '../src/index.ts'
import { posix } from 'node:path'
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from '@earendil-works/pi-ai/compat'
import { createAgent, createSession, definePlugin, toolError, Type } from '@ji.dev/llm'
import { afterEach, describe, expect, it } from 'vitest'
import { editTool, files, fileTool, memWorkspace, ok } from '../src/index.ts'

const CONFIG = 'const timeout = 1000;\nconst retries = 2;\n'

/** What the approver below returns for a call the person refuses. */
const REFUSED = 'Refused.'

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

describe('preview, with a plugin that asks before a change', () => {
  const editOne = ['edit', { path: 'a.ts', edits: [{ old_text: 'one', new_text: 'two' }] }] as const

  it('should show the change before anything is written, and leave the file alone when it is refused (scenario 2.10)', async () => {
    // Arrange
    const workspace = rooted({ '/w/a.ts': 'one\n' })
    const model = faux([calls(['read', { path: 'a.ts' }]), calls([...editOne]), fauxAssistantMessage('done')])
    const asked: Shown[] = []

    // Act
    const results = await approving(workspace, model, ({ title, detail }) => {
      asked.push({ title, detail })
      return false
    })

    // Assert
    expect(asked).toEqual([{ title: 'Edit a.ts (+1 -1)', detail: '@@ -1,1 +1,1 @@\n-one\n+two' }])
    expect(results[1]).toMatchObject({
      isError: true,
      content: [{ text: REFUSED }],
    })
    expect(workspace.get('/w/a.ts')).toBe('one\n')
  })

  it('should write the change once it is approved, and show a new file as one', async () => {
    // Arrange
    const workspace = rooted({ '/w/a.ts': 'one\n' })
    const model = faux([
      calls(['read', { path: 'a.ts' }]),
      calls([...editOne], ['edit', { path: 'new.ts', content: 'a\nb\n' }]),
      fauxAssistantMessage('done'),
    ])
    const titles: string[] = []

    // Act
    const results = await approving(workspace, model, ({ title }) => {
      titles.push(title)
      return true
    })

    // Assert
    expect(titles).toEqual(['Edit a.ts (+1 -1)', 'Create new.ts (2 lines)'])
    expect(text(results[1])).toMatch(/^Edited a\.ts \(\+1 -1\)\./)
    expect(workspace.get('/w/a.ts')).toBe('two\n')
    expect(workspace.get('/w/new.ts')).toBe('a\nb\n')
  })

  it('should not ask about calls that change no file, nor about a change the tool refuses', async () => {
    // Arrange
    const workspace = rooted({ '/w/a.ts': 'one\n', '/w/b.ts': 'b\n' })
    const model = faux([
      calls(['read', { path: 'a.ts' }], ['edit', { path: 'b.ts', content: 'unread' }]),
      calls(['edit', { path: 'a.ts', edits: [{ old_text: 'missing', new_text: 'x' }] }]),
      calls(['edit', { path: 'a.ts', edits: 'not a list' }]),
      calls(['edit', { edits: [{ old_text: 'one', new_text: 'two' }] }]),
      fauxAssistantMessage('done'),
    ])
    let asked = 0

    // Act
    const results = await approving(workspace, model, () => {
      asked++
      return true
    })

    // Assert
    expect(asked).toBe(0)
    expect(results.map(r => r.isError)).toEqual([false, true, true, true, true])
    expect(text(results[1])).toContain('b.ts exists and you have not read it.')
    expect(text(results[2])).toContain('old_text not found')
    expect(text(results[4])).toContain('path must be a string.')
    expect(workspace.get('/w/b.ts')).toBe('b\n')
  })

  it('should write the text that was shown, not what a second run of the transform gives (E9)', async () => {
    // Arrange: a transform that breaks the rule and returns something new every time
    let runs = 0
    const stamp = fileTool({
      name: 'stamp',
      description: 'Write a run number to a file.',
      parameters: Type.Object({ path: Type.String() }),
      transform: () => () => ok(`run ${++runs}\n`),
    })
    const workspace = rooted({})
    const model = faux([calls(['stamp', { path: 'n.txt' }]), fauxAssistantMessage('done')])
    const shown: (string | undefined)[] = []

    // Act
    await approving(
      workspace,
      model,
      ({ detail }) => {
        shown.push(detail)
        return true
      },
      { tools: [stamp] },
    )

    // Assert
    expect(shown).toEqual(['@@ -1,0 +1,1 @@\n+run 1'])
    expect(workspace.get('/w/n.txt')).toBe('run 1\n')
  })

  it('should write nothing when the file changes while the person is deciding', async () => {
    // Arrange
    const workspace = rooted({ '/w/a.ts': 'one\n' })
    const model = faux([calls(['read', { path: 'a.ts' }]), calls([...editOne]), fauxAssistantMessage('done')])

    // Act
    const results = await approving(workspace, model, () => {
      workspace.set('/w/a.ts', 'one, edited by hand\n')
      return true
    })

    // Assert
    expect(text(results[1])).toContain('The file is not at the version you last read')
    expect(workspace.get('/w/a.ts')).toBe('one, edited by hand\n')
  })

  it('should ask the same whichever of the two plugins comes first', async () => {
    // Arrange
    const workspace = rooted({ '/w/a.ts': 'one\n' })
    const model = faux([calls(['read', { path: 'a.ts' }]), calls([...editOne]), fauxAssistantMessage('done')])
    const fileTools = files(workspace)
    const titles: string[] = []
    const asking = approver(fileTools, ({ title }) => {
      titles.push(title)
      return true
    })

    // Act
    await createSession(createAgent({ model, plugins: [asking, fileTools] })).send('go').state

    // Assert
    expect(titles).toEqual(['Edit a.ts (+1 -1)'])
    expect(workspace.get('/w/a.ts')).toBe('two\n')
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
function calls(...list: [name: string, args: JsonObject][]): ReturnType<typeof fauxAssistantMessage> {
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

/** What a person deciding is shown. */
type Shown = Pick<ChangePreview, 'title' | 'detail'>

/**
 * Asks the way an approval plugin would, without one: `decide` sees the preview, and a yes runs the call it fixed.
 * Calls the preview knows nothing about run unasked.
 */
function approver(fileTools: FilesPlugin, decide: (shown: Shown) => boolean): Plugin {
  return definePlugin({
    name: 'approver',
    async *toolCall(call, next, { signal }) {
      const preview = await fileTools.preview(call, signal)
      if (preview === undefined) {
        return yield* next(call)
      }
      if ('role' in preview) {
        return preview
      }
      return decide(preview) ? yield* next(preview.call) : toolError(call, REFUSED)
    },
  })
}

/** The files plugin, and the approver asking about what its preview shows. */
async function approving(
  workspace: MemWorkspace,
  model: Model<Api>,
  decide: (shown: Shown) => boolean,
  options?: FilesOptions,
): Promise<ToolResultMessage[]> {
  const fileTools = files(workspace, options)
  const plugins = [fileTools, approver(fileTools, decide)]
  const state = await createSession(createAgent({ model, plugins })).send('go').state
  return toolResults(state)
}

function toolResults(state: AgentState): ToolResultMessage[] {
  return state.messages.filter((m): m is ToolResultMessage => m.role === 'toolResult')
}

function text(result: ToolResultMessage): string {
  return result.content.map(c => (c.type === 'text' ? c.text : '')).join('\n')
}
