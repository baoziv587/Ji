// The agent: the model and its thinking, and the features it runs with, all working in the directory the coding agent
// was started from. What of theirs waits for a yes is the permissions' to say, and how it is asked, the screen's.

import type { Agent, AnyPlugin, ModelInfo, Plugin, ThinkingLevel } from '@ji.dev/llm'
import type { FilesPlugin, Workspace } from '@ji.dev/plugin-files'
import type { CommandExecutor, ShellPlugin } from '@ji.dev/plugin-shell'
import type { Feature } from '../features/feature.ts'
import process from 'node:process'
import { createAgent, findModel } from '@ji.dev/llm'
import { createCompactionPlugin } from '@ji.dev/plugin-compaction'
import { files } from '@ji.dev/plugin-files'
import { createSearchPlugin, createShellPlugin } from '@ji.dev/plugin-shell'
import { createTruncateToolResultsPlugin } from '@ji.dev/plugin-truncate-tool-results'

/** A longer history costs more on every call, and the model attends to it less well. */
const MAX_HISTORY_TOKENS = 200_000

/** The tool plugins, built before the features: the permissions need the files' and the shell's to tell their calls. */
export interface Plugins {
  /** read and edit, on any file the workspace reaches: what lies outside the root is asked about, not refused. */
  files: FilesPlugin
  /** bash, run by the executor. */
  shell: ShellPlugin
  /** grep, run by the executor. */
  search: Plugin
}

/** Where the files are and where commands run: the two backends, local or remote, chosen by whoever starts the agent. */
export function createPlugins(workspace: Workspace, executor: CommandExecutor): Plugins {
  return {
    files: files(workspace),
    shell: createShellPlugin(executor),
    search: createSearchPlugin(executor),
  }
}

/**
 * The model comes from DEEPSEEK_MODEL and the level from DEEPSEEK_THINKING. Both are checked here, so a typo stops the
 * coding agent before the first prompt: UnknownModelError and UnsupportedThinkingError list the choices.
 */
export function startAgent(root: string, features: readonly Feature[], asking: Plugin): Agent {
  const model = findModel(`deepseek/${process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash'}`)
  return createAgent({
    model,
    thinking: (process.env.DEEPSEEK_THINKING ?? 'high') as ThinkingLevel,
    system: `You are a concise assistant running in a terminal. Use tools when they help. File paths are relative to ${root}.`,
    plugins: [...contextPlugins(model), ...pluginList(features, asking)],
  })
}

/**
 * What keeps the history within the model's context: a tool result is cut before the model sees it, and an old part
 * of the conversation becomes a summary. First in the list, so the cut applies to what every other plugin returns.
 */
function contextPlugins(model: ModelInfo): AnyPlugin[] {
  return [createTruncateToolResultsPlugin(), createCompactionPlugin({ maxTokens: contextLimitOf(model) })]
}

/**
 * Where the history is compacted: at 80% of the model's context window, and never past MAX_HISTORY_TOKENS. The usage
 * line shows the history against it.
 */
export function contextLimitOf(model: ModelInfo): number {
  return Math.min(Math.floor(model.contextWindow * 0.8), MAX_HISTORY_TOKENS)
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
