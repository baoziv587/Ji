// Skills in the terminal: the folders under ~/.agents/skills, each with a SKILL.md, as Claude Code keeps them. Each is
// a slash command named after its folder, with no `run`: the line goes to the model as typed, and the skills plugin
// stores the call and hands the model the instructions. /reload-skills reads the folder again, so a skill written
// while the coding agent runs is found without a restart.

import type { Skill, SkillsPlugin } from '@ji.dev/plugin-skills'
import type { Command, Say } from '../agent/commands.ts'
import type { Feature } from './feature.ts'
import { log } from '@clack/prompts'
import { createSkillsPlugin } from '@ji.dev/plugin-skills'
import { abbreviateHomePath } from '@ji.dev/tui'

export interface SkillsFeature extends Feature {
  plugin: SkillsPlugin
}

/** What /reload-skills has to say goes to `say`: the terminal's log, unless told otherwise. */
export function createSkillsFeature(dir: string, say: Say = log): SkillsFeature {
  const plugin = createSkillsPlugin(dir)

  const reloading: Command = {
    name: '/reload-skills',
    hint: `reads ${abbreviateHomePath(dir)} again`,
    run: () => {
      plugin.reload().then(
        loaded => say.success(`${countOf(loaded.length)} in ${abbreviateHomePath(dir)}`),
        (error: unknown) => say.error(error instanceof Error ? error.message : String(error)),
      )
    },
  }

  return {
    plugin,
    get commands() {
      return [reloading, ...plugin.skills().map(commandOf)]
    },
  }
}

/** No `run`: the line goes to the model as typed, and the plugin takes it from there. */
function commandOf(skill: Skill): Command {
  return {
    name: `/${skill.name}`,
    arg: skill.argumentHint,
    hint: firstSentence(skill.description) || 'runs the skill',
    group: 'Skills',
  }
}

/** Up to the first full stop that ends a sentence; the whole text when there is none. */
function firstSentence(text: string): string {
  const end = text.search(/[.!?。](\s|$)/)
  return end === -1 ? text : text.slice(0, end + 1)
}

function countOf(n: number): string {
  return n === 1 ? '1 skill' : `${n} skills`
}
