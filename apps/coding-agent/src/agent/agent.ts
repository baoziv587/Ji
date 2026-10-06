// The agent: the model and its thinking, and the plugins it runs with, all working in the directory the coding agent
// was started from. What of theirs waits for a yes is the permissions' to say, and how it is asked, the screen's.

import type { Agent, Plugin, ThinkingLevel } from '@ji.dev/llm'
import type { FilesPlugin } from '@ji.dev/plugin-files'
import type { ShellPlugin } from '@ji.dev/plugin-shell'
import process from 'node:process'
import { createAgent } from '@ji.dev/llm'
import { files, localWorkspace } from '@ji.dev/plugin-files'
import { createLocalExecutor, createSearchPlugin, createShellPlugin } from '@ji.dev/plugin-shell'

/** The plugins the agent runs with, apart from the one that asks: what it asks about comes from their previews. */
export interface Plugins {
  /** read and edit, on any file: what lies outside the root is asked about, not refused. */
  files: FilesPlugin
  /** bash, run in the root. */
  shell: ShellPlugin
  /** grep, run in the root. */
  search: Plugin
}

export function createPlugins(root: string): Plugins {
  const executor = createLocalExecutor({ cwd: root })
  return {
    files: files(localWorkspace(root, { allow: () => true })),
    shell: createShellPlugin(executor),
    search: createSearchPlugin(executor),
  }
}

/**
 * The model comes from DEEPSEEK_MODEL and the level from DEEPSEEK_THINKING. Both are checked here, so a typo stops the
 * coding agent before the first prompt: UnknownModelError and UnsupportedThinkingError list the choices.
 */
export function startAgent(root: string, plugins: Plugins, asking: Plugin): Agent {
  return createAgent({
    model: `deepseek/${process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash'}`,
    thinking: (process.env.DEEPSEEK_THINKING ?? 'high') as ThinkingLevel,
    system: `You are a concise assistant running in a terminal. Use tools when they help. File paths are relative to ${root}.`,
    plugins: pluginList(plugins, asking),
  })
}

/** Every tool the agent can call, by name, for the help line. */
export function toolNamesOf(plugins: Plugins, asking: Plugin): string[] {
  return pluginList(plugins, asking)
    .flatMap(p => p.tools ?? [])
    .map(t => t.name)
}

/** The shell's before the files plugin: a command runs after the edits the model wrote before it. */
function pluginList(plugins: Plugins, asking: Plugin): (Plugin | ShellPlugin | FilesPlugin)[] {
  return [plugins.shell, plugins.search, plugins.files, asking]
}
