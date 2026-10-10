// A feature: a plugin the agent runs with, and what the terminal adds around its tools. The list of them in main.ts is
// the one place a tool set is added to the coding agent: createAgent takes the plugins, choices the approvals, the
// command menu the commands. Plain objects: a plugin that needs nothing of the terminal is `{ plugin }`.

import type { AnyPlugin } from '@ji.dev/llm'
import type { Preview } from '@ji.dev/plugin-choices'
import type { Command } from '../agent/commands.ts'

export interface Feature {
  /** AnyPlugin, so a plugin with state of its own fits, the files plugin with its ledger say. */
  plugin: AnyPlugin
  /** Asked before a call of its tools runs; without one, they run unasked. */
  approve?: Preview
  /** Its slash commands, listed after the built-in ones. */
  commands?: Command[]
}
