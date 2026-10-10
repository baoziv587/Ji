// The commands typed after a `/`, and the menu of them that opens as one is typed: the ones whose name or hint has
// what is typed, one chosen. ↑↓ choose, Tab completes, Enter runs the chosen one, or completes one that takes
// something, and Esc closes. Enter on a whole line runs the command it names.
//
// What is typed is looked for in the name first, then in the hint, case aside: the names that start with it come first,
// then the names that have it, then the hints that do. Where it was found is underlined, in the name and the hint
// alike, so a match by the hint shows why it is there.

import type { Editing, KeyHint } from '@ji.dev/tui'
import type { Command } from '../agent/commands.ts'
import type { Menu } from './bars.ts'
import { styleText } from 'node:util'
import { log } from '@clack/prompts'
import { editingText, EMPTY_EDITING } from '@ji.dev/tui'
import { commandOf, hintOf } from '../agent/commands.ts'

/** What a key of the menu's did: the input after it, and whether what is in it is to be sent. */
export interface MenuKey {
  editing: Editing
  submit: boolean
}

/** A command is being typed: a `/` and no space yet. */
const TYPING = /^\/\S*$/

/** Where a command matched, best first: a name starting with what is typed, a name having it, a hint having it. */
const NAME_START = 0
const NAME = 1
const HINT = 2

export class CommandMenu {
  /** Read every time: a feature's commands can change while the coding agent runs. */
  private readonly commands: () => readonly Command[]
  /** The command chosen, by its place among the ones that match; the first again as the text changes. */
  private selected = 0
  private typed = ''

  constructor(commands: () => readonly Command[]) {
    this.commands = commands
  }

  /** The menu as the bars show it; none while no command is typed, or none matches. What is typed is underlined. */
  view(editing: Editing): Menu | undefined {
    const matching = this.matching(editing)
    if (matching === undefined) {
      return undefined
    }

    const query = this.typed.slice(1).toLowerCase()
    const items = matching.map((command): KeyHint => {
      const [key, action] = hintOf(command)
      return [underlined(key, query), underlined(action, query)]
    })
    return { items, selected: this.selected }
  }

  /** A key while the menu is open; undefined for one that is not the menu's, or while it is closed. */
  onKey(name: string, editing: Editing): MenuKey | undefined {
    const matching = this.matching(editing)
    if (matching === undefined) {
      return undefined
    }

    const command = matching[this.selected]
    switch (name) {
      case 'up':
        this.selected = (this.selected + matching.length - 1) % matching.length
        return { editing, submit: false }
      case 'down':
        this.selected = (this.selected + 1) % matching.length
        return { editing, submit: false }
      case 'tab':
        return { editing: completed(command), submit: false }
      case 'escape':
        return { editing: EMPTY_EDITING, submit: false }
      case 'return':
        if (editing.pasting) {
          return undefined
        }
        return { editing: completed(command), submit: command.arg === undefined }
    }

    return undefined
  }

  /**
   * Runs the command `message` names, with what follows it; false when the message is not a command, or names one that
   * has nothing to run here, so the message is sent as it is.
   */
  run(message: string): boolean {
    const named = commandOf(this.commands(), message)
    if (named === undefined) {
      return false
    }

    const { command, name, arg } = named
    if (command === undefined) {
      log.warn(`No such command: ${name}. /help lists them.`)
      return true
    }
    if (command.run === undefined) {
      return false
    }

    command.run(arg)
    return true
  }

  /** The commands with what is typed in their name or hint, best matches first, while a command is being typed. */
  private matching(editing: Editing): Command[] | undefined {
    const typed = editingText(editing)
    if (typed !== this.typed) {
      this.typed = typed
      this.selected = 0
    }
    if (!TYPING.test(typed)) {
      return undefined
    }

    // One list per rank, each in the commands' own order; the ranks one after the other
    const query = typed.slice(1).toLowerCase()
    const byRank: Command[][] = [[], [], []]
    for (const command of this.commands()) {
      const rank = rankOf(command, query)
      if (rank !== undefined) {
        byRank[rank].push(command)
      }
    }

    const matching = byRank.flat()
    return matching.length === 0 ? undefined : matching
  }
}

/** How well a command matches `query`, lowercased; undefined for one that does not. An empty query matches every name. */
function rankOf({ name, hint }: Command, query: string): number | undefined {
  const lowered = name.slice(1).toLowerCase()
  if (lowered.startsWith(query)) {
    return NAME_START
  }
  if (lowered.includes(query)) {
    return NAME
  }
  if (hint.toLowerCase().includes(query)) {
    return HINT
  }
  return undefined
}

/** `text` with its first `query` underlined, the query lowercased already; as it is without one, or with an empty query. */
function underlined(text: string, query: string): string {
  if (query === '') {
    return text
  }
  const at = text.toLowerCase().indexOf(query)
  if (at === -1) {
    return text
  }

  const end = at + query.length
  return `${text.slice(0, at)}${styleText('underline', text.slice(at, end))}${text.slice(end)}`
}

/** The command's name in the input, with a space after it when it takes something, for what comes next. */
function completed(command: Command): Editing {
  return { ...EMPTY_EDITING, before: command.arg === undefined ? command.name : `${command.name} ` }
}
