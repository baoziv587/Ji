// The commands typed after a `/`, and the menu of them that opens as one is typed: the ones that start with what is
// typed, one chosen. ↑↓ choose, Tab completes, Enter runs the chosen one, or completes one that takes something, and
// Esc closes. Enter on a whole line runs the command it names.

import type { Editing, KeyHint } from '@ji.dev/tui'
import type { Menu } from './bars.ts'
import { log } from '@clack/prompts'
import { editingText, EMPTY_EDITING } from '@ji.dev/tui'

export interface Command {
  name: string
  /** What it takes after its name, as the menu shows it; without one, the menu runs it at once. */
  arg?: string
  hint: string
  /** What it does in the terminal. Without one, the line goes to the model as typed: a plugin knows what it means. */
  run?: (arg: string) => void
  /** Where /help lists it, by name only among the others of its group; without one, under Commands with its hint. */
  group?: string
}

/** What a key of the menu's did: the input after it, and whether what is in it is to be sent. */
export interface MenuKey {
  editing: Editing
  submit: boolean
}

/** A command is being typed: a `/` and no space yet. */
const TYPING = /^\/\S*$/

export class CommandMenu {
  /** Read every time: a feature's commands can change while the coding agent runs. */
  private readonly commands: () => readonly Command[]
  /** The command chosen, by its place among the ones that match; the first again as the text changes. */
  private selected = 0
  private typed = ''

  constructor(commands: () => readonly Command[]) {
    this.commands = commands
  }

  /** The commands without a group: `/think` and what it does, for /help. */
  hints(): KeyHint[] {
    return this.commands()
      .filter(command => command.group === undefined)
      .map(hintOf)
  }

  /** The names of the commands with a group, by group, in the order the groups first appear. */
  groups(): Map<string, string[]> {
    const groups = new Map<string, string[]>()
    for (const { name, group } of this.commands()) {
      if (group !== undefined) {
        groups.set(group, [...(groups.get(group) ?? []), name])
      }
    }
    return groups
  }

  /** The menu as the bars show it; none while no command is typed, or none matches. */
  view(editing: Editing): Menu | undefined {
    const matching = this.matching(editing)
    if (matching === undefined) {
      return undefined
    }

    return { items: matching.map(hintOf), selected: this.selected }
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
    if (!message.startsWith('/')) {
      return false
    }

    const [name, ...rest] = message.split(/\s+/)
    const command = this.commands().find(c => c.name === name)
    if (command === undefined) {
      log.warn(`No such command: ${name}. /help lists them.`)
      return true
    }
    if (command.run === undefined) {
      return false
    }

    command.run(rest.join(' '))
    return true
  }

  /** The commands that start with what is typed, while a command is being typed. */
  private matching(editing: Editing): Command[] | undefined {
    const typed = editingText(editing)
    if (typed !== this.typed) {
      this.typed = typed
      this.selected = 0
    }
    if (!TYPING.test(typed)) {
      return undefined
    }

    const matching = this.commands().filter(command => command.name.startsWith(typed))
    return matching.length === 0 ? undefined : matching
  }
}

/** The command's name in the input, with a space after it when it takes something, for what comes next. */
function completed(command: Command): Editing {
  return { ...EMPTY_EDITING, before: command.arg === undefined ? command.name : `${command.name} ` }
}

/** The name alone in the key column, so a long argument hint does not push every column out; the hint comes after it. */
function hintOf({ name, arg, hint }: Command): KeyHint {
  return [name, arg === undefined ? hint : `${arg}  ${hint}`]
}
