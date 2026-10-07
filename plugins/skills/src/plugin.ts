import type { Message, Plugin } from '@ji.dev/llm'
import type { SkillCall } from './call.ts'
import type { Skill } from './skill.ts'
import { join } from 'node:path'
import { before, definePlugin } from '@ji.dev/llm'
import { formatSkillCall, parseCommandLine, parseSkillCall } from './call.ts'
import { instructionsOf, loadSkills } from './skill.ts'

export interface SkillsPlugin extends Plugin {
  /** The load in progress, or the last one: the first starts at creation, so nothing waits for it. */
  readonly loading: Promise<readonly Skill[]>
  /** What the last load found, by name; empty until it is done. */
  skills: () => readonly Skill[]
  /** Reads the folder again: a skill added or changed counts from the next message on. */
  reload: () => Promise<readonly Skill[]>
}

export function createSkillsPlugin(dir: string): SkillsPlugin {
  let current = new Map<string, Skill>()
  /** Every version loaded since the start, by hash: a call gets the version it was made with. */
  const versions = new Map<string, Skill>()

  const load = (): Promise<readonly Skill[]> =>
    loadSkills(dir).then(loaded => {
      current = new Map(loaded.map(skill => [skill.name, skill]))
      for (const skill of loaded) {
        versions.set(skill.hash, skill)
      }
      return loaded
    })
  let loading = load()

  /** Waits for the load in progress, so a message sent while the folder is read is not missed. A load that failed is
   * reported through `loading`; the hooks go on with what the last one found. */
  const loaded = (): Promise<unknown> => loading.catch(() => undefined)

  const resolve = (call: SkillCall): Skill | undefined => versions.get(call.hash) ?? current.get(call.name)

  const plugin = definePlugin({
    name: 'skills',
    input: async messages => {
      await loaded()
      return messages.map(m => mapUserText(m, text => skillCallOf(text, current)))
    },
    request: before(async req => {
      await loaded()
      return {
        ...req,
        systemPrompt: withSkillList(req.systemPrompt, current.values()),
        messages: req.messages.map(m => mapUserText(m, text => instructionsFor(text, resolve))),
      }
    }),
  })

  return {
    ...plugin,
    get loading() {
      return loading
    },
    skills: () => [...current.values()],
    reload: () => {
      loading = load()
      return loading
    },
  }
}

/**
 * The system prompt with the skills listed, each with where its SKILL.md is, so the model reads one when the task calls
 * for it without anyone typing /name; the prompt as it is when there are none.
 */
function withSkillList(prompt: string, skills: Iterable<Skill>): string {
  const lines = [...skills].map(skill => `- ${skill.name}: ${skill.description} (${join(skill.dir, 'SKILL.md')})`)
  if (lines.length === 0) {
    return prompt
  }

  return `${prompt}\n\nSkills, each a SKILL.md with instructions: read it and follow it when the task calls for that skill.\n${lines.join('\n')}`
}

/** `/name args` of a skill becomes the call as stored; any other text, `/usr/bin` or an unknown name say, stays. */
function skillCallOf(text: string, current: Map<string, Skill>): string {
  const command = parseCommandLine(text)
  if (command === undefined) {
    return text
  }

  const skill = current.get(command.name)
  if (skill === undefined) {
    return text
  }

  return formatSkillCall({ name: skill.name, hash: skill.hash, args: command.args })
}

function instructionsFor(text: string, resolve: (call: SkillCall) => Skill | undefined): string {
  const call = parseSkillCall(text)
  if (call === undefined) {
    return text
  }

  const skill = resolve(call)
  if (skill === undefined) {
    return text
  }

  return instructionsOf(skill, call.args)
}

/** `f` over the text of a user message; the same object back when it has no text or `f` changes nothing. */
function mapUserText(message: Message, f: (text: string) => string): Message {
  if (message.role !== 'user' || typeof message.content !== 'string') {
    return message
  }

  const content = f(message.content)
  return content === message.content ? message : { ...message, content }
}
