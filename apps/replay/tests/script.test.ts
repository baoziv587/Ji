import type { Case, TrajectoryStep } from '../src/testkit.ts'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { callsOf, toolName, toScript, turnsOf } from '../src/script.ts'

const user = (msg: string): TrajectoryStep => ({ src: 'user', msg, tools: [], obs: null })
const system = (msg: string): TrajectoryStep => ({ src: 'system', msg, tools: [], obs: null })
const say = (msg: string): TrajectoryStep => ({ src: 'agent', msg, tools: [], obs: null })
function run(msg: string, cmds: Array<[string, string]>, obs: string | null): TrajectoryStep {
  return { src: 'agent', msg, tools: cmds.map(([fn, cmd]) => ({ fn, cmd })), obs }
}
const caseOf = (steps: TrajectoryStep[]): Case => ({ id: 'c', task: 'demo', agent: 'a', model: 'm', reward: 1, steps })

describe('toScript', () => {
  it('should turn a trajectory into segments of tool turns that end in a text-only turn', () => {
    // Arrange
    const c = caseOf([
      system('you are an agent'),
      user('fix the build'),
      say('Let me look.'),
      run('Listing files', [['Bash', 'ls']], 'a.txt'),
      say('Done: the build passes.'),
    ])

    // Act
    const script = toScript(c)

    // Assert
    expect(script.system).toBe('you are an agent')
    expect(script.tools).toEqual(['Bash'])
    expect(script.segments).toEqual([
      {
        input: 'fix the build',
        turns: [
          {
            text: 'Let me look.\n\nListing files',
            calls: [{ id: 'call_0', name: 'Bash', cmd: 'ls', obs: 'a.txt' }],
            synthetic: false,
          },
          { text: 'Done: the build passes.', calls: [], synthetic: false },
        ],
      },
    ])
  })

  it('should start a new segment at each later user message and drop later system steps', () => {
    // Arrange
    const c = caseOf([
      user('Warmup'),
      say('ready'),
      user('the task'),
      system('Added workspace context'),
      run('', [['sh', 'make']], 'ok'),
    ])

    // Act
    const script = toScript(c)

    // Assert
    expect(script.segments.map(s => s.input)).toEqual(['Warmup', 'the task'])
    expect(script.segments[0].turns).toEqual([{ text: 'ready', calls: [], synthetic: false }])
    expect(script.segments[1].turns.map(t => [t.text, t.calls.length, t.synthetic])).toEqual([
      ['', 1, false],
      ['(end of recorded segment)', 0, true],
    ])
  })

  it('should give identical calls of one turn the same observation, and other calls none', () => {
    // Arrange
    const c = caseOf([
      user('go'),
      run(
        '',
        [
          ['Read', 'a'],
          ['Read', 'a'],
          ['Read', 'b'],
        ],
        'contents of a',
      ),
    ])

    // Act
    const calls = callsOf(toScript(c))

    // Assert
    expect(calls.map(call => call.obs)).toEqual(['contents of a', 'contents of a', ''])
  })

  it('should stop after maxTurns recorded turns and still close the segment', () => {
    // Arrange
    const c = caseOf([user('go'), ...Array.from({ length: 10 }, (_, i) => run('', [['sh', `step ${i}`]], `${i}`))])

    // Act
    const turns = turnsOf(toScript(c, { maxTurns: 3 }))

    // Assert
    expect(turns.map(t => t.calls.map(call => call.cmd))).toEqual([['step 0'], ['step 1'], ['step 2'], []])
    expect(turns.at(-1)?.synthetic).toBe(true)
  })

  it('should fall back to the task name when the recording has no user message', () => {
    // Act
    const script = toScript(caseOf([say('hello')]))

    // Assert
    expect(script.segments[0].input).toBe('Task: demo')
  })

  it('should end every segment with a text-only turn, and put calls on every other turn, for any trajectory', () => {
    // Arrange
    const step: fc.Arbitrary<TrajectoryStep> = fc.record({
      src: fc.constantFrom('user', 'agent', 'agent', 'agent', 'system'),
      msg: fc.string({ maxLength: 8 }),
      tools: fc.array(
        fc.record({ fn: fc.constantFrom('Bash', 'read file', ''), cmd: fc.constantFrom('ls', 'cat a', '') }),
        { maxLength: 3 },
      ),
      obs: fc.option(fc.string({ maxLength: 8 })),
    })

    fc.assert(
      fc.property(fc.array(step, { maxLength: 30 }), fc.option(fc.nat(10), { nil: undefined }), (steps, maxTurns) => {
        // Act
        const script = toScript(caseOf(steps), { maxTurns })

        // Assert
        for (const { turns } of script.segments) {
          expect(turns.at(-1)?.calls).toEqual([])
          expect(turns.slice(0, -1).every(t => t.calls.length > 0)).toBe(true)
        }
        const ids = callsOf(script).map(c => c.id)
        expect(new Set(ids).size).toBe(ids.length)
        expect(turnsOf(script).filter(t => t.calls.length > 0).length).toBeLessThanOrEqual(maxTurns ?? Infinity)
      }),
    )
  })
})

describe('toolName', () => {
  it('should keep only what provider APIs accept in a tool name', () => {
    expect(toolName('Bash')).toBe('Bash')
    expect(toolName('read file.v2')).toBe('read_file_v2')
    expect(toolName('')).toBe('tool')
    expect(toolName('x'.repeat(80))).toHaveLength(64)
  })
})
