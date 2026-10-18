// The built-in commands: /compact sends the compaction plugin's command, once there is something to compact; /fast
// switches the priority tier, for OpenAI's models only; /model switches the model, fast mode with it where it can
import type { Agent, Api, Model, Run } from '@ji.dev/llm'
import type { CommandOptions } from '../src/agent/commands.ts'
import { createAgent } from '@ji.dev/llm'
import { COMPACT_COMMAND } from '@ji.dev/plugin-compaction'
import { assistantMessage, createFakeModel } from '@ji.dev/testing'
import { describe, expect, it, onTestFinished } from 'vitest'
import { createCommands, runCommand } from '../src/agent/commands.ts'
import { Conversation } from '../src/agent/conversation.ts'

describe('/compact', () => {
  it('should send nothing before the first reply, and the compaction command after it', async () => {
    // Arrange
    const conversation = new Conversation(createAgent({ model: faux() }))
    const sent: string[] = []
    const menu = commandsOf({ conversation, send: m => sent.push(m) })

    // Act
    menu.run('/compact')
    const before = [...sent]
    await conversation.follow(conversation.send('hello')!, replied)
    menu.run('/compact')

    // Assert
    expect(before).toEqual([])
    expect(sent).toEqual([COMPACT_COMMAND])
  })
})

describe('/fast', () => {
  it('should switch on and off as told, and the other way round without a word', () => {
    // Arrange
    const conversation = new Conversation(createAgent({ model: { ...faux(), provider: 'openai' } }))
    const menu = commandsOf({ conversation })
    const seen: boolean[] = []

    // Act
    for (const line of ['/fast on', '/fast on', '/fast', '/fast', '/fast off']) {
      menu.run(line)
      seen.push(conversation.fast)
    }

    // Assert
    expect(seen).toEqual([true, true, false, true, false])
  })

  it('should stay off for a model without the priority tier', () => {
    // Arrange
    const conversation = new Conversation(createAgent({ model: faux() }))
    const menu = commandsOf({ conversation })

    // Act
    menu.run('/fast on')

    // Assert
    expect(conversation.fast).toBe(false)
  })
})

describe('/model', () => {
  it('should keep fast mode on a model with the tier, and turn it off on one without', () => {
    // Arrange
    const openai = { ...faux(), provider: 'openai' }
    const other = faux()
    const conversation = new Conversation(createAgent({ model: openai }))
    const startOn = (spec: string): Agent => createAgent({ model: spec === 'openai' ? openai : other })
    const menu = commandsOf({ conversation, startOn })
    menu.run('/fast on')
    const seen: [string, boolean][] = []

    // Act
    for (const line of ['/model openai', '/model other']) {
      menu.run(line)
      seen.push([conversation.agent.model.provider, conversation.fast])
    }

    // Assert
    expect(seen).toEqual([
      ['openai', true],
      [other.provider, false],
    ])
  })

  it('should keep the model when the switch fails', () => {
    // Arrange
    const conversation = new Conversation(createAgent({ model: faux() }))
    const before = conversation.agent
    const startOn = (): Agent => {
      throw new Error('Unknown model')
    }
    const menu = commandsOf({ conversation, startOn })

    // Act
    menu.run('/model nope/nothing')

    // Assert
    expect(conversation.agent).toBe(before)
  })
})

const SILENT = { info: () => {}, success: () => {}, warn: () => {}, error: () => {} }

/** The commands of a conversation, run as typed. */
function commandsOf(options: Pick<CommandOptions, 'conversation'> & Partial<CommandOptions>): {
  run: (line: string) => void
} {
  const commands = createCommands({
    tools: [],
    mode: () => '',
    send: () => {},
    quit: () => {},
    say: SILENT,
    help: () => {},
    ...options,
  })
  return { run: line => runCommand(commands(), line, () => {}) }
}

async function replied(run: Run): Promise<void> {
  await run.result
}

function faux(): Model<Api> {
  const fake = createFakeModel([assistantMessage('hi')])
  onTestFinished(() => fake.dispose())
  return fake.model
}
