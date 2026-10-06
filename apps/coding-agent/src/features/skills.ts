// Skills: the folders under ~/.agents/skills, each with a SKILL.md, as Claude Code keeps them. Each is a slash command
// named after its folder. The line goes to the model as typed, and the request hook puts the skill's instructions in
// its place: the history and the terminal keep `/name args`, the model gets the whole file. /reload-skills reads the
// folder again, so a skill written while the coding agent runs is found without a restart.
//
//   SKILL.md   front matter between --- lines: description (the menu's hint, its first sentence), argument-hint (what
//              the command takes) and user-invocable (false hides it); then the instructions, in markdown

import type { Message } from '@ji.dev/llm'
import type { Command } from '../ui/menu.ts'
import type { Feature } from './feature.ts'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { log } from '@clack/prompts'
import { before, definePlugin } from '@ji.dev/llm'
import { abbreviateHomePath } from '@ji.dev/tui'

export interface Skill {
  /** The folder's name: the command is /name. */
  name: string
  /** The folder, told to the model: a skill's other files are relative to it. */
  dir: string
  description: string
  argumentHint?: string
  /** The instructions: SKILL.md without its front matter. */
  body: string
}

export interface SkillsFeature extends Feature {
  /** Reads the folder again; the commands and what the model gets follow. */
  reload: () => Promise<readonly Skill[]>
}

export async function createSkillsFeature(dir: string): Promise<SkillsFeature> {
  let skills = byName(await loadSkills(dir))

  const reload = async (): Promise<readonly Skill[]> => {
    const loaded = await loadSkills(dir)
    skills = byName(loaded)
    return loaded
  }

  const reloading: Command = {
    name: '/reload-skills',
    hint: `reads ${abbreviateHomePath(dir)} again`,
    run: () => {
      reload().then(
        loaded => log.success(`${countOf(loaded.length)} in ${abbreviateHomePath(dir)}`),
        (error: unknown) => log.error(error instanceof Error ? error.message : String(error)),
      )
    },
  }

  const plugin = definePlugin({
    name: 'skills',
    request: before(req => ({ ...req, messages: req.messages.map(m => expand(m, skills)) })),
  })

  return {
    plugin,
    reload,
    get commands() {
      return [reloading, ...[...skills.values()].map(commandOf)]
    },
  }
}

/** The folders of `dir` with a SKILL.md, by name; none when the folder does not exist. */
export async function loadSkills(dir: string): Promise<Skill[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (isMissing(error)) {
      return []
    }
    throw error
  }

  const folders = entries.filter(entry => entry.isDirectory() || entry.isSymbolicLink())
  const found = await Promise.all(folders.map(entry => skillOf(join(dir, entry.name), entry.name)))
  return found.filter(skill => skill !== undefined).sort((a, b) => a.name.localeCompare(b.name))
}

/** What the model gets for `/name args`, the way Claude Code hands a skill over. */
export function instructionsOf(skill: Skill, args = ''): string {
  const parts = [`Base directory for this skill: ${skill.dir}`, skill.body]
  if (args.trim() !== '') {
    parts.push(`ARGUMENTS: ${args.trim()}`)
  }
  return parts.join('\n\n')
}

/** undefined for a folder without a SKILL.md, and for a skill that is not for people (user-invocable: false). */
async function skillOf(folder: string, name: string): Promise<Skill | undefined> {
  let text
  try {
    text = await readFile(join(folder, 'SKILL.md'), 'utf8')
  } catch (error) {
    if (isMissing(error)) {
      return undefined
    }
    throw error
  }

  const { fields, body } = parseSkillFile(text)
  if (fields.get('user-invocable') === 'false') {
    return undefined
  }
  return {
    name,
    dir: folder,
    description: fields.get('description') ?? '',
    argumentHint: fields.get('argument-hint'),
    body,
  }
}

/** The front matter's top-level `key: value` fields, quotes taken off, and the text after it. */
function parseSkillFile(text: string): { fields: Map<string, string>; body: string } {
  const fields = new Map<string, string>()
  const frontMatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (frontMatter === null) {
    return { fields, body: text.trim() }
  }

  for (const line of frontMatter[1].split(/\r?\n/)) {
    const field = line.match(/^([\w-]+):(.*)$/)
    if (field !== null) {
      fields.set(field[1], unquote(field[2].trim()))
    }
  }
  return { fields, body: text.slice(frontMatter[0].length).trim() }
}

function unquote(value: string): string {
  const quoted = value.match(/^"(.*)"$|^'(.*)'$/)
  return quoted === null ? value : (quoted[1] ?? quoted[2])
}

/** A user message `/name args` for a skill becomes its instructions; every other message stays as it is. */
function expand(message: Message, skills: Map<string, Skill>): Message {
  if (message.role !== 'user' || typeof message.content !== 'string') {
    return message
  }

  if (!message.content.startsWith('/')) {
    return message
  }

  // Split the way the command menu splits a line
  const [name, ...rest] = message.content.split(/\s+/)
  const skill = skills.get(name.slice(1))
  if (skill === undefined) {
    return message
  }
  return { ...message, content: instructionsOf(skill, rest.join(' ')) }
}

/** No `run`: the line goes to the model as typed, and the request hook expands it there. */
function commandOf(skill: Skill): Command {
  return { name: `/${skill.name}`, arg: skill.argumentHint, hint: firstSentence(skill.description) || 'runs the skill' }
}

function byName(skills: readonly Skill[]): Map<string, Skill> {
  return new Map(skills.map(skill => [skill.name, skill]))
}

/** Up to the first full stop that ends a sentence; the whole text when there is none. */
function firstSentence(text: string): string {
  const end = text.search(/[.!?。](\s|$)/)
  return end === -1 ? text : text.slice(0, end + 1)
}

function countOf(n: number): string {
  return n === 1 ? '1 skill' : `${n} skills`
}

function isMissing(error: unknown): boolean {
  const code = (error as { code?: unknown }).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}
