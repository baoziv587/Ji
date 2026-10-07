// Skills: the folders with a SKILL.md, how a /name line is stored, and what the model gets for it
import type { AssistantMessage, InputContext, Message, ModelRequest } from '@ji.dev/llm'
import type { SkillsPlugin } from '../src/index.ts'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { user } from '@ji.dev/llm'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  commandLineOf,
  createSkillsPlugin,
  formatSkillCall,
  instructionsOf,
  loadSkills,
  parseSkillCall,
} from '../src/index.ts'

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
      hash: expect.stringMatching(/^[0-9a-f]{12}$/),
    })
    expect(skills[0].body).toBe('# Plain\n\nNo front matter here.')
  })

  it('should give no skills for a folder that does not exist', async () => {
    expect(await loadSkills(join(tmpdir(), 'ji-skills-none'))).toEqual([])
  })

  it('should give the same hash to the same body and different hashes to different ones', async () => {
    // Arrange: the same body, one with front matter and one without
    const dir = await skillsDir({ a: REVIEW, b: '# Review\n\nLook at the diff.\n', c: '# Other\n' })

    // Act
    const [a, b, c] = await loadSkills(dir)

    // Assert
    expect(a.hash).toBe(b.hash)
    expect(c.hash).not.toBe(a.hash)
  })
})

describe('calls', () => {
  it('should read back what it wrote, for any name, hash and arguments', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z][\w.-]{0,20}$/),
        fc.stringMatching(/^[0-9a-f]{12}$/),
        fc.stringMatching(/^(\S+( \S+)*)?$/),
        (name, hash, args) => {
          const call = { name, hash, args }
          expect(parseSkillCall(formatSkillCall(call))).toEqual(call)
          expect(commandLineOf(call)).toBe(args === '' ? `/${name}` : `/${name} ${args}`)
        },
      ),
    )
  })

  it('should read nothing else as a stored call', () => {
    for (const text of ['/review', 'skill://review', 'skill://review@zzz', 'skill://review@3f2a9c1d04b', 'hello']) {
      expect(parseSkillCall(text), text).toBeUndefined()
    }
  })
})

describe('createSkillsPlugin', () => {
  it('should store /name args as a call as it comes in, and leave every other message alone', async () => {
    // Arrange
    const dir = await skillsDir({ review: REVIEW })
    const plugin = createSkillsPlugin(dir)
    const [review] = await loadSkills(dir)
    const messages = [
      user('/review  the diff '),
      user('hello'),
      user('/unknown x'),
      user('/usr/bin/env'),
      user('/review'),
    ]

    // Act: without waiting for the load, which the hook does itself
    const stored = await inputTo(plugin, messages)

    // Assert
    expect(stored.map(m => m.content)).toEqual([
      `skill://review@${review.hash} the diff`,
      'hello',
      '/unknown x',
      '/usr/bin/env',
      `skill://review@${review.hash}`,
    ])
    expect(stored[1]).toBe(messages[1])
  })

  it('should hand the model the instructions for a call, with its arguments', async () => {
    // Arrange
    const dir = await skillsDir({ review: REVIEW })
    const plugin = createSkillsPlugin(dir)
    const [review] = await loadSkills(dir)
    const call = { name: 'review', hash: review.hash, args: 'the diff' }

    // Act
    const sent = await requestedBy(plugin, [user(formatSkillCall(call)), user('hello'), user('/review')])

    // Assert
    expect(sent.map(m => m.content)).toEqual([instructionsOf(review, 'the diff'), 'hello', '/review'])
    expect(instructionsOf(review, 'the diff')).toBe(
      `Base directory for this skill: ${join(dir, 'review')}\n\n# Review\n\nLook at the diff.\n\nARGUMENTS: the diff`,
    )
    expect(instructionsOf(review)).not.toContain('ARGUMENTS')
  })

  it('should list the skills in the system prompt, each with its SKILL.md, and leave the prompt alone with none', async () => {
    // Arrange
    const dir = await skillsDir({ review: REVIEW })
    const plugin = createSkillsPlugin(dir)
    const empty = createSkillsPlugin(await skillsDir({}))

    // Act
    const listed = await systemPromptBy(plugin, 'Be brief.')
    const alone = await systemPromptBy(empty, 'Be brief.')

    // Assert
    expect(listed).toBe(
      `Be brief.\n\nSkills, each a SKILL.md with instructions: read it and follow it when the task calls for that skill.\n- review: Reviews a change. Use it before a commit, e.g. on a branch. (${join(dir, 'review', 'SKILL.md')})`,
    )
    expect(alone).toBe('Be brief.')
  })

  it('should keep an earlier call at its version when the skill changes and is reloaded', async () => {
    // Arrange
    const dir = await skillsDir({ review: REVIEW })
    const plugin = createSkillsPlugin(dir)
    const [earlier] = await inputTo(plugin, [user('/review')])

    // Act
    await writeFile(join(dir, 'review', 'SKILL.md'), '# Review v2\n\nLook harder.\n')
    await plugin.reload()
    const [later] = await inputTo(plugin, [user('/review')])
    const sent = await requestedBy(plugin, [earlier, later])

    // Assert
    expect(later.content).not.toBe(earlier.content)
    expect(sent[0].content).toContain('Look at the diff.')
    expect(sent[1].content).toContain('Look harder.')
  })

  it('should take the current version for a hash it never loaded, and send an unknown skill as it is', async () => {
    // Arrange
    const dir = await skillsDir({ review: REVIEW })
    const plugin = createSkillsPlugin(dir)
    const resumed = formatSkillCall({ name: 'review', hash: '000000000000', args: '' })
    const gone = formatSkillCall({ name: 'gone', hash: '000000000000', args: 'x' })

    // Act
    const sent = await requestedBy(plugin, [user(resumed), user(gone)])

    // Assert
    expect(sent[0].content).toContain('Look at the diff.')
    expect(sent[1].content).toBe(gone)
  })

  it('should find a skill written after a reload, in skills() and for the next message alike', async () => {
    // Arrange
    const dir = await skillsDir({})
    const plugin = createSkillsPlugin(dir)
    await plugin.loading
    const before = plugin.skills().map(s => s.name)

    // Act
    await mkdir(join(dir, 'review'))
    await writeFile(join(dir, 'review', 'SKILL.md'), REVIEW)
    const loaded = await plugin.reload()
    const [stored] = await inputTo(plugin, [user('/review')])

    // Assert
    expect(before).toEqual([])
    expect(loaded.map(s => s.name)).toEqual(['review'])
    expect(plugin.skills().map(s => s.name)).toEqual(['review'])
    expect(stored.content).toMatch(/^skill:\/\/review@[0-9a-f]{12}$/)
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

/** A step's ctx, the same for both hooks: neither reads the state. */
const ctx: InputContext = {
  signal: new AbortController().signal,
  idle: true,
  state: { messages: [], plugins: {} },
  own: undefined,
}

/** What the input hook stores for the messages. */
function inputTo(plugin: SkillsPlugin, messages: Message[]): Promise<Message[]> {
  return Promise.resolve(plugin.input!(messages, ctx))
}

/** The system prompt the request hook sends on. */
async function systemPromptBy(plugin: SkillsPlugin, systemPrompt: string): Promise<string> {
  let sent = ''
  const next = async function* (req: ModelRequest): AsyncGenerator<never, AssistantMessage> {
    sent = req.systemPrompt
    return {} as AssistantMessage
  }

  const messages: Message[] = []
  const stream = plugin.request!({ systemPrompt, messages } as ModelRequest, next, ctx)
  let step = await stream.next()
  while (!step.done) {
    step = await stream.next()
  }
  return sent
}

/** The messages the request hook sends on, with `next` standing in for the model. */
async function requestedBy(
  plugin: SkillsPlugin,
  messages: ModelRequest['messages'],
): Promise<ModelRequest['messages']> {
  let sent: ModelRequest['messages'] = []
  const next = async function* (req: ModelRequest): AsyncGenerator<never, AssistantMessage> {
    sent = req.messages
    return {} as AssistantMessage
  }

  const stream = plugin.request!({ messages } as ModelRequest, next, ctx)
  let step = await stream.next()
  while (!step.done) {
    step = await stream.next()
  }
  return sent
}
