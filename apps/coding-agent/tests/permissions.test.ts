// What waits for a yes, and what a yes can allow from then on
import type { JsonObject, ToolCall } from '@ji.dev/llm'
import type { PermissionsOptions } from '../src/features/permissions.ts'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { files, localWorkspace } from '@ji.dev/plugin-files'
import { createMemoryExecutor, createShellPlugin } from '@ji.dev/plugin-shell'
import { describe, expect, it } from 'vitest'
import { Permissions } from '../src/features/permissions.ts'

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
    expect(approval.shortcuts().map(o => o.value)).toEqual(['commands'])
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
    expect(approval.outside).toBe(true)
    expect(approval.shortcuts().map(o => o.label)).toEqual([
      expect.stringMatching(/^Yes, and allow reads in .+\/ from now on$/),
    ])
    expect(await asked(permissions, call('read', { path: join(outside, 'b.txt') }))).toBe(false)
    expect(await asked(permissions, call('read', { path: join(outside, '..', 'other.txt') }))).toBe(true)
    expect(await asked(permissions, call('edit', { path: join(outside, 'a.txt'), content: 'x' }))).toBe(true)
    expect(permissions.describeAllowed()).toMatch(/^allows .+\/$/)
  })

  it('should ask about nothing in yolo mode, outside the workspace included, and stay in it', async () => {
    // Arrange
    const { permissions, outside } = await setup({ yolo: true })

    // Act
    permissions.switchMode()
    const askedAbout = await Promise.all([
      asked(permissions, call('bash', { command: 'rm -rf build' })),
      asked(permissions, call('edit', { path: join(outside, 'a.txt'), content: 'x' })),
      asked(permissions, call('read', { path: 'README.md' })),
    ])

    // Assert
    expect(permissions.mode).toBe('yolo')
    expect(askedAbout).toEqual([false, false, false])
    expect(permissions.describeMode()).toMatch(/^yolo:/)
  })
})

// Helpers

async function setup(options: PermissionsOptions = {}): Promise<{ permissions: Permissions; outside: string }> {
  const root = await mkdtemp(join(tmpdir(), 'ji-root-'))
  const outside = await mkdtemp(join(tmpdir(), 'ji-outside-'))
  await writeFile(join(outside, 'a.txt'), 'a\n')
  await writeFile(join(outside, 'b.txt'), 'b\n')

  const workspace = localWorkspace(root, { allow: () => true })
  const fileTools = files(workspace)
  const shellTools = createShellPlugin(createMemoryExecutor(() => ({})))
  return { permissions: new Permissions(workspace, fileTools, shellTools, options), outside }
}

function call(name: string, args: JsonObject): ToolCall {
  return { type: 'toolCall', id: 'c', name, arguments: args }
}

/** The first answer from the previews, as choices takes them. */
async function previewOf(permissions: Permissions, toolCall: ToolCall): Promise<unknown> {
  for (const preview of [permissions.fileCalls, permissions.commandCalls]) {
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
