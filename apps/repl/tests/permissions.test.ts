// What waits for a yes, and what a yes can allow from then on
import type { ToolCall } from '@ji.dev/llm'
import type { Questions } from '@ji.dev/plugin-choices'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { APPROVE } from '@ji.dev/plugin-choices'
import { files, localWorkspace } from '@ji.dev/plugin-files'
import { createMemoryExecutor, createShellPlugin } from '@ji.dev/plugin-shell'
import { describe, expect, it } from 'vitest'
import { Permissions } from '../src/permissions.ts'

describe('permissions', () => {
  it('should ask about every command until a yes allows them all, and ask again once back in ask mode', async () => {
    // Arrange
    const { permissions } = await setup()
    const command = call('bash', { command: 'pnpm test' })

    // Act
    const before = await asked(permissions, command)
    const approval = await permissions.approval(command)
    const reply = approval.take([['commands']])
    const allowed = await asked(permissions, command)
    permissions.switchMode()
    const inAuto = await asked(permissions, command)
    permissions.switchMode()
    const backInAsk = await asked(permissions, command)

    // Assert
    expect(optionsOf(approval.show(question(command)))).toEqual(['yes', 'commands', 'no'])
    expect(reply).toEqual([['yes']])
    expect([before, allowed, inAuto, backInAsk]).toEqual([true, false, false, true])
    expect(permissions.describeAllowed()).toBe('')
  })

  it('should allow reads in the folder of a file outside once a yes says so, and nothing else there', async () => {
    // Arrange
    const { permissions, outside } = await setup()
    const read = call('read', { path: join(outside, 'a.txt') })

    // Act
    const approval = await permissions.approval(read)
    approval.take([['folder']])

    // Assert
    expect(approval.show(question(read)).questions[0].options.map(o => o.label)).toEqual([
      'Yes',
      expect.stringMatching(/^Yes, and allow reads in .+\/ from now on$/),
      'No',
    ])
    expect(await asked(permissions, call('read', { path: join(outside, 'b.txt') }))).toBe(false)
    expect(await asked(permissions, call('read', { path: join(outside, '..', 'other.txt') }))).toBe(true)
    expect(await asked(permissions, call('edit', { path: join(outside, 'a.txt'), content: 'x' }))).toBe(true)
    expect(permissions.describeAllowed()).toMatch(/^allows reads in /)
  })

  it('should still refuse a command that is not a string once every command is allowed', async () => {
    // Arrange
    const { permissions } = await setup()
    ;(await permissions.approval(call('bash', { command: 'ls' }))).take([['commands']])

    // Act
    const proposal = await previewOf(permissions, call('bash', { command: ['rm', '-rf', '/'] }))

    // Assert
    expect(proposal).toMatchObject({ role: 'toolResult', isError: true })
  })
})

// Helpers

async function setup(): Promise<{ permissions: Permissions; outside: string }> {
  const root = await mkdtemp(join(tmpdir(), 'ji-root-'))
  const outside = await mkdtemp(join(tmpdir(), 'ji-outside-'))
  await writeFile(join(outside, 'a.txt'), 'a\n')
  await writeFile(join(outside, 'b.txt'), 'b\n')

  const fileTools = files(localWorkspace(root, { allow: () => true }))
  const shellTools = createShellPlugin(createMemoryExecutor(() => ({})))
  return { permissions: new Permissions(root, fileTools, shellTools), outside }
}

function call(name: string, args: Record<string, unknown>): ToolCall {
  return { type: 'toolCall', id: 'c', name, arguments: args }
}

/** The first answer from the previews, as choices takes them. */
async function previewOf(permissions: Permissions, toolCall: ToolCall): Promise<unknown> {
  for (const preview of permissions.approve) {
    const proposal = await preview(toolCall, new AbortController().signal)
    if (proposal !== undefined) {
      return proposal
    }
  }
  return undefined
}

async function asked(permissions: Permissions, toolCall: ToolCall): Promise<boolean> {
  return (await previewOf(permissions, toolCall)) !== undefined
}

function question(toolCall: ToolCall): Questions {
  return { questions: [{ title: 'Run it', options: APPROVE }], call: toolCall }
}

function optionsOf(q: Questions): string[] {
  return q.questions[0].options.map(o => o.value)
}
