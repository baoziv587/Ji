// What keys do to questions being answered, without a terminal
import type { Choosing, Keypress } from '../src/choosing.ts'
import type { Question } from '../src/index.ts'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { onSend, press, rowCount, sent, start } from '../src/choosing.ts'
import { ask } from '../src/index.ts'

const KEYS: Record<string, Keypress> = {
  up: { name: 'up' },
  down: { name: 'down' },
  left: { name: 'left' },
  right: { name: 'right' },
  space: { name: 'space', char: ' ' },
  enter: { name: 'return', char: '\r' },
  backspace: { name: 'backspace' },
  x: { name: 'x', char: 'x' },
}

const question: fc.Arbitrary<Question> = fc.record({
  title: fc.constantFrom('q?', 'r?'),
  options: fc.constantFrom(
    [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ],
    [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
      { value: 'c', label: 'C' },
    ],
  ),
  multiple: fc.boolean(),
  other: fc.boolean(),
  initial: fc.constantFrom(undefined, 'b', 'missing'),
})

const session = fc.record({
  questions: fc.array(question, { minLength: 1, maxLength: 3 }),
  keys: fc.array(fc.constantFrom(...Object.keys(KEYS)), { maxLength: 40 }),
})

describe('press', () => {
  it('should always keep the tab and every cursor on something that exists', () => {
    fc.assert(
      fc.property(session, ({ questions, keys }) => {
        // Act
        const states = trace(questions, keys)

        // Assert
        for (const s of states) {
          expect(s.tab).toBeGreaterThanOrEqual(0)
          expect(s.tab).toBeLessThanOrEqual(questions.length === 1 ? 0 : questions.length)
          s.rows.forEach((row, i) => expect(row).toBeLessThan(rowCount(questions[i])))
        }
      }),
    )
  })

  it('should always be done only with every question answered, in a reply ask accepts', async () => {
    await fc.assert(
      fc.asyncProperty(session, async ({ questions, keys }) => {
        // Act
        const done = trace(questions, keys).find(s => s.done)
        fc.pre(done !== undefined)

        // Assert
        expect(done.answers.every(a => a !== undefined)).toBe(true)
        const asking = ask({ questions }, new AbortController().signal)
        await asking.next()
        await expect(asking.next(sent(done))).resolves.toMatchObject({ done: true })
      }),
    )
  })

  it('should answer several questions tab by tab, and send from the last tab', () => {
    // Arrange
    const questions: Question[] = [
      {
        title: 'Which one?',
        options: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ],
        other: true,
      },
      {
        title: 'Which ones?',
        options: [
          { value: 'x', label: 'X' },
          { value: 'y', label: 'Y' },
        ],
        multiple: true,
        other: true,
      },
    ]

    // Act: B; then X toggled and "x" typed on Other; then send
    const keys = ['down', 'enter', 'space', 'down', 'down', 'x', 'enter']
    const before = trace(questions, keys).at(-1)!
    const after = press(before, KEYS.enter)

    // Assert
    expect(onSend(before)).toBe(true)
    expect(before.done).toBe(false)
    expect(sent(after)).toEqual([['b'], ['x', 'x']])
  })

  it('should refuse to send while a question is unanswered, and go to it', () => {
    // Arrange
    const questions: Question[] = [
      { title: 'One?', options: [{ value: 'a', label: 'A' }] },
      { title: 'Two?', options: [{ value: 'b', label: 'B' }] },
    ]

    // Act
    const s = trace(questions, ['right', 'right', 'enter']).at(-1)!

    // Assert
    expect(s).toMatchObject({ tab: 0, done: false, error: 'Answer this one first.' })
  })

  it('should not take an empty Other as an answer', () => {
    // Arrange
    const questions: Question[] = [{ title: 'One?', options: [{ value: 'a', label: 'A' }], other: true }]

    // Act
    const s = trace(questions, ['down', 'enter']).at(-1)!

    // Assert
    expect(s).toMatchObject({ done: false, error: 'Type an answer, or pick an option.' })
  })
})

/** Every state from the start, one per key. */
function trace(questions: Question[], keys: string[]): Choosing[] {
  const states = [start(questions)]
  for (const key of keys) {
    states.push(press(states.at(-1)!, KEYS[key]))
  }
  return states
}
