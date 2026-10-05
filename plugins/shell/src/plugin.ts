// Two plugins, so an agent can search without being able to run commands. Neither has state (X12).
//
//   createShellPlugin   bash, and its place in a turn: a command depends on every other call, since what it reads and
//                       writes is unknown, so it runs alone where the model put it (§3.5). It must come before the
//                       files plugin: then bash cuts the turn first, and files orders the edits inside each part.
//   createSearchPlugin  grep. Only reads, so it runs alongside everything but bash.
//
//   Approval is another plugin's: `preview` says what a call would run, in the shape @ji.dev/plugin-choices takes, and
//   the two never import each other (RFC-0005 §8.3).

import type { Plugin, ToolCall, ToolResultMessage } from '@ji.dev/llm'
import type { CommandExecutor } from './executor.ts'
import type { BashOptions, GrepOptions } from './tools.ts'
import { callsOf, definePlugin, toolError } from '@ji.dev/llm'
import { BASH, createBashTool, createGrepTool } from './tools.ts'

export interface ShellPlugin extends Plugin {
  /**
   * What a call would run, before it runs; give it to the choices plugin:
   *
   *     choices({ answer, approve: [shellPlugin.preview] })
   *
   * undefined for every call but bash's. A tool error, so nobody is asked, when the command is not a string: what is
   * shown is the string itself, and so is what runs (X11).
   */
  preview: (call: ToolCall) => CommandPreview | ToolResultMessage | undefined
}

export interface CommandPreview {
  title: string
  /** The whole command, exactly as it will run. */
  detail: string
}

export function createShellPlugin(executor: CommandExecutor, options?: BashOptions): ShellPlugin {
  const plugin = definePlugin({
    name: 'shell',
    tools: [createBashTool(executor, options)],
    async *toolCalls(message, next) {
      const results: ToolResultMessage[] = []
      for (const part of splitAtBarriers(callsOf(message), call => call.name === BASH)) {
        results.push(...(yield* next({ ...message, content: part })))
      }
      return results
    },
  })

  return {
    ...plugin,
    preview(call) {
      if (call.name !== BASH) {
        return undefined
      }

      // A hook sees the arguments before the schema has checked them: only a string is shown, so only a string runs
      const command: unknown = call.arguments.command
      return typeof command === 'string'
        ? { title: 'Run command', detail: command }
        : toolError(call, 'command must be a string.')
    },
  }
}

export function createSearchPlugin(executor: CommandExecutor, options?: GrepOptions): Plugin {
  return definePlugin({ name: 'search', tools: [createGrepTool(executor, options)] })
}

/**
 * The items in order, cut into parts so every item `alone` picks is a part by itself: [a, b, X, c] gives [a, b], [X],
 * [c]. No part is empty, and the parts joined are the items. For a plugin of your own whose calls must run alone.
 */
export function splitAtBarriers<T>(items: readonly T[], alone: (item: T) => boolean): T[][] {
  const parts: T[][] = []
  let current: T[] = []

  for (const item of items) {
    if (!alone(item)) {
      current.push(item)
      continue
    }
    if (current.length > 0) {
      parts.push(current)
    }
    parts.push([item])
    current = []
  }

  if (current.length > 0) {
    parts.push(current)
  }
  return parts
}
