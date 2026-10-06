// Skills: the folders with a SKILL.md as commands, and what the model gets for /name
import type { AssistantMessage, ModelRequest, RequestContext } from '@ji.dev/llm'
import type { SkillsFeature } from '../src/features/skills.ts'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { user } from '@ji.dev/llm'
import { describe, expect, it } from 'vitest'
import { createSkillsFeature, instructionsOf, loadSkills } from '../src/features/skills.ts'

const REVIEW = `---
name: review
description: "Reviews a change. Use it before a commit, e.g. on a branch."
argument-hint: "[target]"
---

# Review

Look at the diff.
`

describe('loadSkills', () => {
  it('should take every folder with a SKILL.md, by name, and leave the others out', async () => {
    // Arrange
    const dir = await skillsDir({
      review: REVIEW,
      plain: '# Plain\n\nNo front matter here.\n',
      hidden: '---\nuser-invocable: false\n---\nNot for people.\n',
    })
    await mkdir(join(dir, 'empty'))

    // Act
    const skills = await loadSkills(dir)

    // Assert
    expect(skills.map(s => s.name)).toEqual(['plain', 'review'])
    expect(skills[1]).toEqual({
      name: 'review',
      dir: join(dir, 'review'),
      description: 'Reviews a change. Use it before a commit, e.g. on a branch.',
      argumentHint: '[target]',
      body: '# Review\n\nLook at the diff.',
    })
    expect(skills[0].body).toBe('# Plain\n\nNo front matter here.')
  })

  it('should find none where the folder does not exist', async () => {
    expect(await loadSkills(join(tmpdir(), 'ji-no-such-skills'))).toEqual([])
  })
})

describe('createSkillsFeature', () => {
  it('should list /reload-skills, then a command per skill with the first sentence as its hint', async () => {
    // Arrange
    const dir = await skillsDir({ review: REVIEW, plain: 'Plain.\n' })

    // Act
    const feature = await createSkillsFeature(dir)

    // Assert
    expect(feature.commands?.map(c => [c.name, c.arg, c.hint])).toEqual([
      ['/reload-skills', undefined, expect.stringContaining('reads')],
      ['/plain', undefined, 'runs the skill'],
      ['/review', '[target]', 'Reviews a change.'],
    ])
    expect(feature.commands?.slice(1).every(c => c.run === undefined)).toBe(true)
  })

  it('should hand the model the instructions for /name args and leave every other message alone', async () => {
    // Arrange
    const dir = await skillsDir({ review: REVIEW })
    const feature = await createSkillsFeature(dir)
    const [review] = await loadSkills(dir)
    const messages = [user('/review the diff'), user('hello'), user('/unknown'), user('/review')]

    // Act
    const sent = await requestedBy(feature.plugin.request!, messages)

    // Assert
    expect(sent.map(m => m.content)).toEqual([
      instructionsOf(review, 'the diff'),
      'hello',
      '/unknown',
      instructionsOf(review),
    ])
    expect(instructionsOf(review, 'the diff')).toBe(
      `Base directory for this skill: ${join(dir, 'review')}\n\n# Review\n\nLook at the diff.\n\nARGUMENTS: the diff`,
    )
    expect(instructionsOf(review)).not.toContain('ARGUMENTS')
  })

  it('should find a skill written after a reload, in the commands and for the model alike', async () => {
    // Arrange
    const dir = await skillsDir({})
    const feature = await createSkillsFeature(dir)
    const before = feature.commands?.map(c => c.name)

    // Act
    await mkdir(join(dir, 'review'))
    await writeFile(join(dir, 'review', 'SKILL.md'), REVIEW)
    const loaded = await feature.reload()
    const sent = await requestedBy(feature.plugin.request!, [user('/review')])

    // Assert
    expect(before).toEqual(['/reload-skills'])
    expect(loaded.map(s => s.name)).toEqual(['review'])
    expect(feature.commands?.map(c => c.name)).toEqual(['/reload-skills', '/review'])
    expect(sent[0].content).toContain('Look at the diff.')
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

type RequestHook = NonNullable<SkillsFeature['plugin']['request']>

/** The messages the request hook sends on, with `next` standing in for the model. */
async function requestedBy(hook: RequestHook, messages: ModelRequest['messages']): Promise<ModelRequest['messages']> {
  let sent: ModelRequest['messages'] = []
  const next = async function* (req: ModelRequest): AsyncGenerator<never, AssistantMessage> {
    sent = req.messages
    return {} as AssistantMessage
  }
  const ctx = { signal: new AbortController().signal } as RequestContext<unknown>

  const stream = hook({ messages } as ModelRequest, next, ctx)
  let step = await stream.next()
  while (!step.done) {
    step = await stream.next()
  }
  return sent
}
