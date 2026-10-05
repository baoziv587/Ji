// The run's event stream (RFC-0005 §3, appendix A): one stream, well formed whatever the timing, interrupts
// and failures; r.text, r.turns and r.summary are projections of it; observe sees it all and changes nothing.
import type { FauxResponseStep } from '@mariozechner/pi-ai'
import type {
  AgentTool,
  Api,
  AssistantMessage,
  Model,
  Plugin,
  PluginList,
  Run,
  RunEvent,
  RunInfo,
  Session,
} from '../src/index.ts'
import process from 'node:process'
import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxToolCall,
  registerApiProvider,
  registerFauxProvider,
  unregisterApiProviders,
} from '@mariozechner/pi-ai'
import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callsOf, createAgent, createSession, definePlugin, tool, toolError, Type } from '../src/index.ts'

// Plugin events are registered with declaration merging, through the package entry like any user would
declare module '../src/index.ts' {
  interface Events {
    'wrap:before': Record<never, never>
    'wrap:after': Record<never, never>
  }
}

/** One model turn: the tool calls it makes, each yielding `updates` values and then failing or not. */
interface CallPlan {
  updates: number
  fail: boolean
}
type Plan = CallPlan[][]

const plan: fc.Arbitrary<Plan> = fc.array(
  fc.array(fc.record({ updates: fc.nat({ max: 4 }), fail: fc.boolean() }), { minLength: 1, size: '-1' }),
  { size: '-1' },
)

/** Stop the run after `at` events: interrupt continues from the last committed state, abort ends the run. */
interface Disruption {
  at: number
  how: 'interrupt' | 'abort'
}

// `at` stays within the length of a run, or the disruption would almost never happen
const interruption: fc.Arbitrary<Disruption> = fc.record({
  at: fc.nat({ max: 40 }),
  how: fc.constantFrom('interrupt', 'abort'),
})
const disruption: fc.Arbitrary<Disruption | undefined> = fc.option(interruption, { nil: undefined })

beforeEach(() => {
  // observe failures are reported as process warnings; keep them out of the test output
  vi.spyOn(process, 'emitWarning').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('run events', () => {
  it('should frame a tool call with tool_call, tool_start, its updates and tool_end', async () => {
    // Arrange
    const chat = session([[{ updates: 2, fail: false }]])

    // Act
    const { events } = await read(chat.send('go'))

    // Assert
    expect(typesOf(events).filter(t => t.startsWith('tool'))).toEqual([
      'tool_call',
      'tool_start',
      'tool_update',
      'tool_update',
      'tool_end',
    ])
  })

  it('should give the step number of every event', async () => {
    // Arrange
    const chat = session([[{ updates: 0, fail: false }]])

    // Act
    const { events } = await read(chat.send('go'))

    // Assert
    expect(events.filter(e => e.type !== 'tool_call_delta').map(e => `${e.t}:${e.type}`)).toEqual([
      '0:step_start',
      '0:step_end',
      '1:step_start',
      '1:model_start',
      '1:tool_call',
      '1:model_end',
      '1:tool_start',
      '1:tool_end',
      '1:step_end',
      '2:step_start',
      '2:model_start',
      '2:text',
      '2:model_end',
      '2:step_end',
      '3:run_end',
    ])
  })

  it("should stream a call's arguments before tool_call, with those written so far", async () => {
    // Arrange
    const chat = session([[{ updates: 0, fail: false }]])

    // Act
    const { events } = await read(chat.send('go'))

    // Assert
    const deltas = events.filter(e => e.type === 'tool_call_delta')
    const called = events.findIndex(e => e.type === 'tool_call')
    expect(deltas.map(e => e.delta).join('')).toBe(JSON.stringify({ updates: 0, fail: false }))
    expect(deltas.at(-1)?.call).toMatchObject({ id: 'c0.0', name: 'work', arguments: { updates: 0, fail: false } })
    expect(events.findLastIndex(e => e.type === 'tool_call_delta')).toBeLessThan(called)
  })

  it('should give every argument delta the id its tool_call has, when the provider sends the id late', async () => {
    // Arrange
    const chat = createSession(
      createAgent({ model: lateId(['{"updates"', ':0,', '"fail":false}']), tools: [work(undefined)] }),
    )

    // Act
    const { events } = await read(chat.send('go'))

    // Assert
    const written = events.flatMap(e => {
      switch (e.type) {
        case 'tool_call':
          return [[e.type, e.call.id]]
        case 'tool_call_delta':
          return [[e.type, e.call.id, e.delta]]
        default:
          return []
      }
    })
    expect(written).toEqual([
      ['tool_call_delta', 'late', '{"updates":0,'],
      ['tool_call_delta', 'late', '"fail":false}'],
      ['tool_call', 'late'],
    ])
  })

  it('should give a plain tool a start and an end but no update', async () => {
    // Arrange
    const plain = tool({
      name: 'plain',
      description: 'returns at once',
      parameters: Type.Object({}),
      run: () => 'done',
    })
    const chat = createSession(
      createAgent({ model: faux([callsTo('plain'), fauxAssistantMessage('ok')]), tools: [plain] }),
    )

    // Act
    const { events } = await read(chat.send('go'))

    // Assert
    expect(typesOf(events).filter(t => t.startsWith('tool_'))).toEqual(['tool_call', 'tool_start', 'tool_end'])
  })

  it('should give an intercepted call a tool_start and a tool_end', async () => {
    // Arrange
    const deny = definePlugin({
      name: 'deny',
      async *toolCall(call) {
        return toolError(call, 'denied')
      },
    })
    const chat = session([[{ updates: 3, fail: false }]], [deny])

    // Act
    const { events } = await read(chat.send('go'))

    // Assert
    const end = events.find(e => e.type === 'tool_end')
    expect(typesOf(events).filter(t => t.startsWith('tool_'))).toEqual(['tool_call', 'tool_start', 'tool_end'])
    expect(end?.type === 'tool_end' && end.result.isError).toBe(true)
  })

  it('should put the events a plugin yields before next ahead of the inner events, and those after it behind', async () => {
    // Arrange
    const wrap = definePlugin({
      name: 'wrap',
      async *toolCall(call, next) {
        yield { type: 'wrap:before' }
        const result = yield* next(call)
        yield { type: 'wrap:after' }
        return result
      },
    })
    const chat = session([[{ updates: 1, fail: false }]], [wrap])

    // Act
    const { events } = await read(chat.send('go'))

    // Assert
    expect(typesOf(events).filter(t => t.startsWith('tool_') || t.startsWith('wrap:'))).toEqual([
      'tool_call',
      'tool_start',
      'wrap:before',
      'tool_update',
      'wrap:after',
      'tool_end',
    ])
  })

  it('should close an interrupted step with step_cancelled listing the calls still running', async () => {
    // Arrange
    const chat = session([[{ updates: 5, fail: false }]])
    const r = chat.send('go')

    // Act
    const { events } = await read(r, (e, n) => {
      if (e.type === 'tool_update' && n > 0) {
        chat.send('stop', { when: 'now' })
      }
    })

    // Assert
    const cancelled = events.find(e => e.type === 'step_cancelled')
    expect(cancelled).toMatchObject({ reason: 'interrupt', open: [{ id: 'c0.0' }] })
  })

  it('should end a failed run with run_end carrying the RunError the promises reject with', async () => {
    // Arrange
    const chat = createSession(
      createAgent({ model: faux([fauxAssistantMessage('x', { stopReason: 'error', errorMessage: 'overloaded' })]) }),
    )
    const r = chat.send('go')

    // Act
    const { events, error } = await read(r)

    // Assert
    const end = events.at(-1)
    expect(end).toMatchObject({ type: 'run_end', outcome: 'failed', error: { kind: 'provider' } })
    expect(end?.type === 'run_end' && end.outcome === 'failed' && end.error).toBe(error)
  })

  it('should always be well formed, pair every tool_start, and keep every update inside its call', async () => {
    await fc.assert(
      fc.asyncProperty(fc.scheduler(), plan, disruption, async (s, p, d) => {
        // Arrange
        const life = lifecycle()
        const chat = session(p, [], { s, life })
        const r = chat.send('go')

        // Act
        const { events } = await s.waitFor(read(r, disrupt(chat, r, d)))
        await settle(s)

        // Assert
        expectWellFormed(events)
        expectPairedTools(events)
        expectUpdatesInsideCalls(events, p)
        expect(life.closed).toBe(life.started)
      }),
    )
  })

  it('should always start the calls of a turn in call order, after the model is done and after tool_call', async () => {
    await fc.assert(
      fc.asyncProperty(fc.scheduler(), plan, async (s, p) => {
        // Arrange
        const chat = session(p, [], { s, life: lifecycle() })

        // Act
        const { events } = await s.waitFor(read(chat.send('go')))

        // Assert
        for (const step of stepsOf(events)) {
          const end = step.find(e => e.type === 'model_end')
          const starts = step.filter(e => e.type === 'tool_start').map(e => e.call.id)
          const called = step.filter(e => e.type === 'tool_call').map(e => e.call.id)
          const planned = end?.type === 'model_end' ? callsOf(end.message).map(c => c.id) : []

          const toolEvents = step.flatMap((e, i) => (isToolEvent(e) ? [i] : []))

          expect(starts).toEqual(planned)
          expect(called).toEqual(planned)
          expect(toolEvents.every(i => end !== undefined && i > step.indexOf(end))).toBe(true)
        }
      }),
    )
  })

  it('should always emit what the tool yields, in the order it yields it, and nothing after a failure', async () => {
    await fc.assert(
      fc.asyncProperty(fc.scheduler(), plan, async (s, p) => {
        // Arrange
        const chat = session(p, [], { s, life: lifecycle() })

        // Act
        const { events } = await s.waitFor(read(chat.send('go')))

        // Assert
        p.flat().forEach((planned, k) => {
          const id = idsOf(p)[k]
          const updates = events.filter(e => e.type === 'tool_update' && e.call.id === id)
          const end = events.find(e => e.type === 'tool_end' && e.call.id === id)

          expect(updates.map(e => e.type === 'tool_update' && e.data)).toEqual(range(planned.updates))
          expect(end?.type === 'tool_end' && end.result.isError).toBe(planned.fail)
        })
      }),
    )
  })

  it('should always emit nothing from a cancelled step after its step_cancelled', async () => {
    await fc.assert(
      fc.asyncProperty(fc.scheduler(), plan, interruption, async (s, p, d) => {
        // Arrange
        const chat = session(p, [], { s, life: lifecycle() })
        const r = chat.send('go')

        // Act
        const { events } = await s.waitFor(read(r, disrupt(chat, r, d)))
        await settle(s)

        // Assert
        events.forEach((e, i) => {
          if (e.type === 'step_cancelled') {
            expect(['step_start', 'run_end']).toContain(events[i + 1]?.type)
          }
        })
      }),
    )
  })
})

describe('run projections', () => {
  it('should always make r.text, r.turns and r.summary agree with the event stream', async () => {
    await fc.assert(
      fc.asyncProperty(fc.scheduler(), plan, async (s, p) => {
        // Arrange
        const chat = session(p, [], { s, life: lifecycle() })
        const r = chat.send('go')
        const text = collect(r.text)

        // Act
        const { events } = await s.waitFor(read(r))

        // Assert
        const deltas = events.flatMap(e => (e.type === 'text' ? [e.delta] : []))
        const ends = events.flatMap(e => (e.type === 'step_end' ? [e] : []))
        const runEnd = events.at(-1)
        expect((await text).join('')).toBe(deltas.join(''))
        expect(await collect(r.turns)).toEqual(ends.map(({ type: _, ...record }) => record))
        expect(runEnd?.type === 'run_end' && runEnd.summary).toEqual(await r.summary)
      }),
    )
  })

  it('should always time each tool call in step_end exactly as its tool_end reports', async () => {
    await fc.assert(
      fc.asyncProperty(fc.scheduler(), plan, async (s, p) => {
        // Arrange
        const chat = session(p, [], { s, life: lifecycle() })

        // Act
        const { events } = await s.waitFor(read(chat.send('go')))

        // Assert
        for (const step of stepsOf(events)) {
          const end = step.at(-1)
          const reported = Object.fromEntries(step.flatMap(e => (e.type === 'tool_end' ? [[e.call.id, e.ms]] : [])))
          if (end?.type === 'step_end' && end.turn.kind === 'model') {
            expect(end.timing.toolMs).toEqual(reported)
          }
        }
      }),
    )
  })
})

describe('observe', () => {
  it('should receive every event of the run, from the first one', async () => {
    // Arrange
    const seen: RunEvent[] = []
    const chat = session([[{ updates: 1, fail: false }]], [observer('log', e => seen.push(e))])

    // Act
    const { events } = await read(chat.send('go'))

    // Assert
    expect(seen).toEqual(events)
  })

  it('should keep calling the other observers when one throws, and report the failure as a warning', async () => {
    // Arrange
    const seen: string[] = []
    const plugins = [
      observer('broken', () => {
        throw new Error('observer bug')
      }),
      observer('log', e => seen.push(e.type)),
    ]
    const chat = session([[{ updates: 1, fail: false }]], plugins)

    // Act
    const { events } = await read(chat.send('go'))

    // Assert
    expect(seen).toEqual(events.map(e => e.type))
    expect(process.emitWarning).toHaveBeenCalledWith(expect.stringContaining('observer bug'), 'ObserveWarning')
  })

  it('should tell concurrent runs of one agent apart by run and session id', async () => {
    // Arrange
    const seen: Array<{ e: RunEvent; run: RunInfo }> = []
    const agent = createAgent({
      model: faux(Array.from({ length: 2 }, () => fauxAssistantMessage('ok'))),
      plugins: [observer('log', (e, run) => seen.push({ e, run }))],
    })

    // Act
    const runs = [createSession(agent).send('a'), createSession(agent).send('b')]
    await Promise.all(runs.map(async r => r.result))

    // Assert
    const byRun = Map.groupBy(seen, x => x.run.id)
    expect(byRun.size).toBe(2)
    expect(new Set(seen.map(x => x.run.session)).size).toBe(2)
    for (const group of byRun.values()) {
      expectWellFormed(group.map(x => x.e))
    }
  })

  it('should always see the same stream as a reader, whatever the order of the plugins', async () => {
    await fc.assert(
      fc.asyncProperty(fc.scheduler(), plan, fc.nat(), async (s, p, rotate) => {
        // Arrange
        const seen: RunEvent[][] = [[], [], []]
        const observers = seen.map((log, i) => observer(`o${i}`, e => log.push(e)))
        const order = observers.map((_, i) => observers[(i + rotate) % observers.length])
        const chat = session(p, order, { s, life: lifecycle() })

        // Act
        const { events } = await s.waitFor(read(chat.send('go')))

        // Assert
        for (const log of seen) {
          expect(log).toEqual(events)
        }
      }),
    )
  })

  it('should never change what the run does, even when observers throw', async () => {
    await fc.assert(
      fc.asyncProperty(plan, fc.array(fc.boolean(), { minLength: 1 }), async (p, throwing) => {
        // Arrange
        const observers = throwing.map((fails, i) =>
          observer(`o${i}`, () => {
            if (fails) {
              throw new Error('observer bug')
            }
          }),
        )

        // Act
        const watched = await session(p, observers).send('go').state
        const plain = await session(p).send('go').state

        // Assert
        expect(transcript(watched.messages)).toEqual(transcript(plain.messages))
      }),
    )
  })
})

// Helpers

interface Lifecycle {
  started: number
  closed: number
}

function lifecycle(): Lifecycle {
  return { started: 0, closed: 0 }
}

interface Timing {
  s: fc.Scheduler
  life: Lifecycle
}

/** A session whose model makes the planned calls to `work`, then answers; spare answers follow an interrupt. */
function session(p: Plan, plugins: PluginList = [], timing?: Timing): Session {
  const responses: FauxResponseStep[] = [
    ...p.map((calls, i) =>
      fauxAssistantMessage(
        calls.map((call, j) => fauxToolCall('work', { ...call }, { id: `c${i}.${j}` })),
        { stopReason: 'toolUse' },
      ),
    ),
    ...Array.from({ length: 3 }, () => fauxAssistantMessage('done')),
  ]
  return createSession(createAgent({ model: faux(responses), tools: [work(timing)], plugins }))
}

/** Yields 0 … updates-1, then returns or throws. With a scheduler, every step waits for it. */
function work(timing: Timing | undefined): AgentTool {
  const pause = async (): Promise<void> => {
    await timing?.s.schedule(Promise.resolve())
  }

  return tool({
    name: 'work',
    description: 'yields updates, then succeeds or fails',
    parameters: Type.Object({ updates: Type.Number(), fail: Type.Boolean() }),
    async *run({ updates, fail }) {
      if (timing) {
        timing.life.started++
      }
      try {
        for (let i = 0; i < updates; i++) {
          await pause()
          yield i
        }
        await pause()
        if (fail) {
          throw new Error('work failed')
        }
        return 'worked'
      } finally {
        if (timing) {
          timing.life.closed++
        }
      }
    },
  })
}

const registrations: Array<{ unregister: () => void }> = []
afterEach(() => {
  registrations.splice(0).forEach(r => r.unregister())
})

function faux(responses: FauxResponseStep[]): Model<Api> {
  const registration = registerFauxProvider()
  registration.setResponses(responses)
  registrations.push(registration)
  return registration.getModel()
}

/** A model that calls `work` with `pieces` of arguments, its id coming with the second as some providers do; then answers. */
function lateId(pieces: string[]): Model<Api> {
  const api = 'late-id'
  let calls = 0
  registerApiProvider(
    {
      api,
      stream: () => {
        throw new Error('streamSimple only')
      },
      streamSimple: () => {
        const stream = createAssistantMessageEventStream()
        const first = calls++ === 0
        queueMicrotask(async () => {
          if (!first) {
            const message = fauxAssistantMessage('done')
            stream.push({ type: 'done', reason: 'stop', message })
            stream.end(message)
            return
          }

          const message = fauxAssistantMessage([fauxToolCall('work', {}, { id: '' })], { stopReason: 'toolUse' })
          const [block] = callsOf(message)
          stream.push({ type: 'toolcall_start', contentIndex: 0, partial: message })
          for (const [i, delta] of pieces.entries()) {
            if (i === 1) {
              block.id = 'late'
            }
            stream.push({ type: 'toolcall_delta', contentIndex: 0, delta, partial: message })
            // The stream hands on the same message: each piece is read before the next changes it, as over a network
            await new Promise(resolve => setTimeout(resolve))
          }
          block.arguments = JSON.parse(pieces.join('')) as Record<string, unknown>
          stream.push({ type: 'toolcall_end', contentIndex: 0, toolCall: block, partial: message })
          stream.push({ type: 'done', reason: 'toolUse', message })
          stream.end(message)
        })
        return stream
      },
    },
    api,
  )
  registrations.push({ unregister: () => unregisterApiProviders(api) })
  return { ...faux([]), api }
}

function callsTo(name: string): AssistantMessage {
  return fauxAssistantMessage([fauxToolCall(name, {}, { id: 'only' })], { stopReason: 'toolUse' })
}

function observer(name: string, observe: (e: RunEvent, run: RunInfo) => void): Plugin {
  return definePlugin({ name, observe })
}

/** Reads every event; `onEvent` may disrupt the run. A failed run returns the error it threw. */
async function read(
  r: Run,
  onEvent?: (e: RunEvent, n: number) => void,
): Promise<{ events: RunEvent[]; error?: unknown }> {
  const events: RunEvent[] = []
  try {
    for await (const e of r) {
      events.push(e)
      onEvent?.(e, events.length)
    }
    return { events }
  } catch (error) {
    return { events, error }
  }
}

function disrupt(chat: Session, r: Run, d: Disruption | undefined): (e: RunEvent, n: number) => void {
  return (e, n) => {
    if (d === undefined || n !== d.at || e.type === 'run_end') {
      return
    }
    if (d.how === 'interrupt') {
      chat.send('stop', { when: 'now' })
    } else {
      r.abort()
    }
  }
}

/** Lets cancelled generators finish closing: their return() waits for the scheduled pauses they are stuck in. */
async function settle(s: fc.Scheduler): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await s.waitAll()
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const all: T[] = []
  for await (const x of source) {
    all.push(x)
  }
  return all
}

function isToolEvent(e: RunEvent): boolean {
  return e.type === 'tool_start' || e.type === 'tool_update' || e.type === 'tool_end'
}

/** Without the argument deltas: the faux model cuts the arguments at random. */
function typesOf(events: RunEvent[]): string[] {
  return events.filter(e => e.type !== 'tool_call_delta').map(e => e.type)
}

function idsOf(p: Plan): string[] {
  return p.flatMap((calls, i) => calls.map((_, j) => `c${i}.${j}`))
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i)
}

/** The events of each step, from its step_start up to what closes it; run_end is not part of any step. */
function stepsOf(events: RunEvent[]): RunEvent[][] {
  const steps: RunEvent[][] = []
  for (const e of events) {
    if (e.type === 'step_start') {
      steps.push([e])
    } else if (e.type !== 'run_end') {
      steps.at(-1)?.push(e)
    }
  }
  return steps
}

/** Appendix A.1: run ::= step* run_end, each step opened by step_start and closed by step_end or step_cancelled. */
function expectWellFormed(events: RunEvent[]): void {
  expect(events.filter(e => e.type === 'run_end')).toHaveLength(1)
  expect(events.at(-1)?.type).toBe('run_end')
  expect(events[0]?.type).toBe('step_start')

  const steps = stepsOf(events)
  steps.forEach((step, i) => {
    const closer = step.at(-1)?.type
    const isLast = i === steps.length - 1
    if (!isLast || closer === 'step_end' || closer === 'step_cancelled') {
      expect(['step_end', 'step_cancelled']).toContain(closer)
    }
    expect(step.slice(1, -1).map(e => e.type)).not.toContain('step_start')
  })
}

/** O1: in each step, the tool_end ids plus the ids left open by step_cancelled are exactly the tool_start ids. */
function expectPairedTools(events: RunEvent[]): void {
  for (const step of stepsOf(events)) {
    const started = step.flatMap(e => (e.type === 'tool_start' ? [e.call.id] : []))
    const ended = step.flatMap(e => (e.type === 'tool_end' ? [e.call.id] : []))
    const last = step.at(-1)
    const open = last?.type === 'step_cancelled' ? last.open.map(c => c.id) : []
    expect([...ended, ...open].toSorted()).toEqual(started.toSorted())
  }
}

/** O8: every tool_update of a call lies between that call's tool_start and its tool_end (or the step's end). */
function expectUpdatesInsideCalls(events: RunEvent[], p: Plan): void {
  for (const step of stepsOf(events)) {
    for (const id of idsOf(p)) {
      const start = step.findIndex(e => e.type === 'tool_start' && e.call.id === id)
      const end = step.findIndex(e => e.type === 'tool_end' && e.call.id === id)
      const updates = step.flatMap((e, i) => (e.type === 'tool_update' && e.call.id === id ? [i] : []))
      for (const i of updates) {
        expect(i).toBeGreaterThan(start)
        expect(end === -1 || i < end).toBe(true)
      }
    }
  }
}

/** What a history says, without timestamps and usage that differ between runs. */
function transcript(messages: Array<{ role: string; content: unknown }>): string[] {
  return messages.map(m => `${m.role}:${JSON.stringify(m.content)}`)
}
