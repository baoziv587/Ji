// Skills in the terminal: the commands the menu lists for the folders with a SKILL.md
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSkillsFeature } from '../src/features/skills.ts'

const REVIEW = `---
name: review
description: "Reviews a change. Use it before a commit, e.g. on a branch."
argument-hint: "[target]"
---

# Review

Look at the diff.
`

describe('createSkillsFeature', () => {
  it('should list /reload-skills, then a command per skill with the first sentence as its hint', async () => {
    // Arrange
    const dir = await skillsDir({ review: REVIEW, plain: 'Plain.\n' })

    // Act
    const feature = createSkillsFeature(dir)
    const atOnce = feature.commands?.map(c => c.name)
    await feature.plugin.loading

    // Assert
    expect(atOnce).toEqual(['/reload-skills'])
    expect(feature.commands?.map(c => [c.name, c.arg, c.hint, c.group])).toEqual([
      ['/reload-skills', undefined, expect.stringContaining('reads'), undefined],
      ['/plain', undefined, 'runs the skill', 'Skills'],
      ['/review', '[target]', 'Reviews a change.', 'Skills'],
    ])
    expect(feature.commands?.slice(1).every(c => c.run === undefined)).toBe(true)
  })

  it('should list a skill written after a reload', async () => {
    // Arrange
    const dir = await skillsDir({})
    const feature = createSkillsFeature(dir)
    await feature.plugin.loading

    // Act
    await mkdir(join(dir, 'review'))
    await writeFile(join(dir, 'review', 'SKILL.md'), REVIEW)
    await feature.plugin.reload()

    // Assert
    expect(feature.commands?.map(c => c.name)).toEqual(['/reload-skills', '/review'])
  })
})

// Helpers

/** A folder with one skill folder per entry, its SKILL.md with the text given. */
async function skillsDir(skills: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ji-skills-'))
  for (const [name, text] of Object.entries(skills)) {
    await mkdir(join(dir, name))
    await writeFile(join(dir, name, 'SKILL.md'), text)
  }
  return dir
}
