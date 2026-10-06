// The agent: the model and its thinking, and the features it runs with, all working in the directory the coding agent
// was started from. What of theirs waits for a yes is the permissions' to say, and how it is asked, the screen's.

import type { Agent, AnyPlugin, Plugin, ThinkingLevel } from '@ji.dev/llm'
import type { FilesPlugin } from '@ji.dev/plugin-files'
import type { ShellPlugin } from '@ji.dev/plugin-shell'
import type { Feature } from '../features/feature.ts'
import process from 'node:process'
import { createAgent } from '@ji.dev/llm'
import { files, localWorkspace } from '@ji.dev/plugin-files'
import { createLocalExecutor, createSearchPlugin, createShellPlugin } from '@ji.dev/plugin-shell'

/** The tool plugins, built before the features: the permissions need the files' and the shell's to tell their calls. */
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
export function startAgent(root: string, features: readonly Feature[], asking: Plugin): Agent {
  return createAgent({
    model: `deepseek/${process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash'}`,
    thinking: (process.env.DEEPSEEK_THINKING ?? 'high') as ThinkingLevel,
    system: `You are a concise assistant running in a terminal. Use tools when they help. File paths are relative to ${root}.`,
    plugins: pluginList(features, asking),
  })
}

/** Every tool the agent can call, by name, for the help line. */
export function toolNamesOf(features: readonly Feature[], asking: Plugin): string[] {
  return pluginList(features, asking)
    .flatMap(p => p.tools ?? [])
    .map(t => t.name)
}

/** The features in their order, then the one that asks, so it sees every call of theirs. */
function pluginList(features: readonly Feature[], asking: Plugin): AnyPlugin[] {
  return [...features.map(f => f.plugin), asking]
}
