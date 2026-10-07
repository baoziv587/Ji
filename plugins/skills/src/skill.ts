// A skill is a folder with a SKILL.md: front matter between --- lines (description, argument-hint for what the
// command takes, user-invocable: false to hide it), then the instructions, in markdown

import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface Skill {
  /** The folder's name: the command is /name. */
  name: string
  /** The folder, told to the model: a skill's other files are relative to it. */
  dir: string
  description: string
  argumentHint?: string
  /** The instructions: SKILL.md without its front matter. */
  body: string
  /** The version a call records: the first 12 hex digits of the body's SHA-256. */
  hash: string
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

/** What the model gets for a skill, the way Claude Code hands one over. */
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
    hash: hashOf(body),
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

function hashOf(body: string): string {
  return createHash('sha256').update(body).digest('hex').slice(0, 12)
}

function isMissing(error: unknown): boolean {
  const code = (error as { code?: unknown }).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}
