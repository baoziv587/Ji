// What is asked about before a call runs. The mode decides what is asked, not how it is answered: every question goes
// to the person.
//
//   ask        before every command, file read and file change
//   auto       approves file calls inside the workspace; commands, and any file call outside it, are still asked about
//   shortcuts  a yes that also changes what is asked from now on: switch to auto, stop asking about reads, allow every
//              command, or allow reads in the folder of a file outside. Switching back to ask takes the last two back

import type { ToolCall } from '@ji.dev/llm'
import type { Option, Preview, Questions, Reply } from '@ji.dev/plugin-choices'
import type { FilesPlugin } from '@ji.dev/plugin-files'
import type { ShellPlugin } from '@ji.dev/plugin-shell'
import { homedir } from 'node:os'
import { dirname, sep } from 'node:path'
import { styleText } from 'node:util'
import { DISMISSED } from '@ji.dev/plugin-choices'
import { localWorkspace } from '@ji.dev/plugin-files'
import { dim, hint } from './text.ts'

export type Mode = 'ask' | 'auto'

/** A question about a call as the person sees it, and what their reply does. */
export interface Approval {
  /** Built again after every switch of the mode, since its title and its shortcuts depend on the mode. */
  show: (questions: Questions) => Questions
  /** A shortcut is a yes: what it changes is done here, and the call takes it as a plain yes. */
  take: (reply: Reply) => Reply
}

const SHORTCUTS = {
  auto: { value: 'auto', label: 'Yes, and approve the rest inside the workspace' },
  reads: { value: 'reads', label: 'Yes, and stop asking about reads inside the workspace' },
  commands: { value: 'commands', label: 'Yes, and allow every command from now on' },
  /** Its label names the folder: see shortcutsFor. */
  folder: { value: 'folder', label: 'Yes, and allow reads in the folder from now on' },
}

export class Permissions {
  /** For choices: which file calls and which commands wait for a yes. */
  readonly approve: readonly Preview[]

  private current: Mode = 'ask'
  /** In ask mode, until the person answers a read with "stop asking about reads". */
  private askReads = true
  /** What a yes said not to ask about again, in either mode: every command, and reads in these folders outside. */
  private readonly allowed = { commands: false, folders: new Set<string>() }

  private readonly fileTools: FilesPlugin
  private readonly shellTools: ShellPlugin
  private readonly fileNames: Set<string>
  private readonly shellNames: Set<string>
  /** Refuses every path outside the root: only to tell where a path leads. */
  private readonly rooted: ReturnType<typeof localWorkspace>
  /** Every file, the root's or not: to tell a file's real path. */
  private readonly anywhere: ReturnType<typeof localWorkspace>

  constructor(root: string, fileTools: FilesPlugin, shellTools: ShellPlugin) {
    this.fileTools = fileTools
    this.shellTools = shellTools
    this.fileNames = new Set(fileTools.tools?.map(t => t.name))
    this.shellNames = new Set(shellTools.tools?.map(t => t.name))
    this.rooted = localWorkspace(root)
    this.anywhere = localWorkspace(root, { allow: () => true })
    this.approve = [this.fileCalls, this.commandCalls]
  }

  get mode(): Mode {
    return this.current
  }

  /** Back in ask mode, nothing is allowed that a yes allowed before: the way to take it back. */
  switchMode(): void {
    this.current = this.current === 'ask' ? 'auto' : 'ask'
    if (this.current === 'ask') {
      this.allowed.commands = false
      this.allowed.folders.clear()
    }
  }

  /** Starts with the mode's name, the word the help line uses for it. */
  describeMode(): string {
    if (this.current === 'auto') {
      return 'auto: approves file calls inside the workspace, asks about the rest'
    }
    const commands = this.allowed.commands ? '' : 'command and '
    return `ask: before every ${commands}file ${this.askReads ? 'read and change' : 'change'}`
  }

  /** What a yes allowed, in either mode: `allows every command, reads in ~/notes/`; empty while nothing is. */
  describeAllowed(): string {
    const parts: string[] = []
    if (this.allowed.commands) {
      parts.push('every command')
    }

    const folders = [...this.allowed.folders]
    if (folders.length === 1) {
      parts.push(`reads in ${home(folders[0])}/`)
    } else if (folders.length > 1) {
      parts.push(`reads in ${folders.length} folders outside`)
    }
    return parts.length === 0 ? '' : `allows ${parts.join(', ')}`
  }

  isCommand(call: ToolCall): boolean {
    return this.shellNames.has(call.name)
  }

  async approval(call: ToolCall): Promise<Approval> {
    const far = await this.outside(call)
    // A read outside can allow the rest of its folder
    const real = far && call.name === 'read' ? await this.realPathOf(call) : undefined
    const folder = real === undefined ? undefined : dirname(real)

    return {
      show: q => {
        const [only] = q.questions
        const [yes, no] = only.options
        const title = `${only.title}? ${dim(`· ${this.describeMode()} ·`)} ${hint('Shift+Tab', 'switches')}`
        const options = [yes, ...this.shortcutsFor(call, far, folder), no]
        return { ...q, questions: [{ ...only, title, options }] }
      },
      take: reply => this.take(reply, folder),
    }
  }

  /**
   * Inside the root, only what the mode asks about; outside it, always, so auto mode never reaches past the root
   * unseen, unless a yes allowed reads in the file's folder.
   */
  private readonly fileCalls: Preview = async (call, signal) => {
    const far = await this.outside(call)
    if (!far && (this.current === 'auto' || (call.name === 'read' && !this.askReads))) {
      return undefined
    }
    if (far && call.name === 'read' && (await this.readAllowed(call))) {
      return undefined
    }

    // The files plugin's preview covers only changes; reads are asked about too
    const reading = call.name === 'read' ? { title: `Read ${String(call.arguments.path)}` } : undefined
    const proposal = (await this.fileTools.preview(call, signal)) ?? reading
    if (!far || proposal === undefined || 'role' in proposal) {
      return proposal
    }
    // The riskiest kind of call, so it is the one question that stands out, and a yes has to be chosen
    return { ...proposal, title: `${proposal.title} ${styleText('yellow', '(outside the workspace)')}`, initial: 'no' }
  }

  /** Every command waits for a yes, until one says not to ask again. A command that is not a string is refused still. */
  private readonly commandCalls: Preview = call => {
    const proposal = this.shellTools.preview(call)
    if (this.allowed.commands && proposal !== undefined && !('role' in proposal)) {
      return undefined
    }
    return proposal
  }

  private async outside(call: ToolCall): Promise<boolean> {
    const path: unknown = call.arguments.path
    if (!this.fileNames.has(call.name) || typeof path !== 'string') {
      return false
    }
    return this.rooted.resolve(path).then(
      () => false,
      () => true,
    )
  }

  /** The real path of the file a call is about; undefined for a call without one. */
  private async realPathOf(call: ToolCall): Promise<string | undefined> {
    const path: unknown = call.arguments.path
    if (typeof path !== 'string') {
      return undefined
    }
    return this.anywhere.resolve(path).catch(() => undefined)
  }

  private async readAllowed(call: ToolCall): Promise<boolean> {
    const real = await this.realPathOf(call)
    return real !== undefined && [...this.allowed.folders].some(folder => real.startsWith(folder + sep))
  }

  /** A command can allow every command; a read outside, its folder; a call inside, what ask mode asks about. */
  private shortcutsFor(call: ToolCall, far: boolean, folder: string | undefined): Option[] {
    if (this.isCommand(call)) {
      return [SHORTCUTS.commands]
    }
    if (far) {
      if (folder === undefined) {
        return []
      }
      return [{ ...SHORTCUTS.folder, label: `Yes, and allow reads in ${home(folder)}/ from now on` }]
    }
    if (this.current === 'auto') {
      return []
    }
    return call.name === 'read' ? [SHORTCUTS.auto, SHORTCUTS.reads] : [SHORTCUTS.auto]
  }

  private take(reply: Reply, folder: string | undefined): Reply {
    const value = reply === DISMISSED ? undefined : reply[0][0]
    if (value === SHORTCUTS.auto.value) {
      this.current = 'auto'
    } else if (value === SHORTCUTS.reads.value) {
      this.askReads = false
    } else if (value === SHORTCUTS.commands.value) {
      this.allowed.commands = true
    } else if (value === SHORTCUTS.folder.value && folder !== undefined) {
      this.allowed.folders.add(folder)
    } else {
      return reply
    }
    return [['yes']]
  }
}

/** A path under the home folder as ~/…, the way a shell shows it. */
function home(path: string): string {
  const dir = homedir()
  return path === dir || path.startsWith(dir + sep) ? `~${path.slice(dir.length)}` : path
}
