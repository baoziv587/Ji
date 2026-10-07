// What a replayed run must look like, given its plan. Pure: everything observed comes in, a list of failures
// comes out; an empty list means the case passed.
//
//   outcome     the run ended done, with the last scripted text as its result
//   history     state.messages is exactly the plan: inputs and interjections, assistant turns (text + calls), tool
//               results; nothing of a cancelled attempt
//   summary     turns, inputs and per-tool call counts agree with the plan; no tool errors
//   events      the ledger found no protocol violation; observe and `for await` saw the same sequence; one
//               step_cancelled per interrupt
//   text        the main model's text deltas join up to the planned text, cancelled attempts included
//   plugins     every hook of the probe ran as often as it should and saw consistent state; input steps say whether
//               they came while idle or after an interrupt
//   model       the faux model got every request it expected, each carrying the right history
//   spans       (with otel) one invoke_agent, a chat span per model call, an execute_tool span per tool call

import type { AgentState, Message, RunError, RunSummary } from '@ji.dev/llm'
import type { LedgerSummary } from './ledger.ts'
import type { Plan } from './plan.ts'
import type { ProbeCounts } from './probe.ts'
import type { SpanStats } from './spans.ts'
import { callsOf as callsIn, textOf } from '@ji.dev/llm'
import { NO_COUNTS } from './probe.ts'
import { callsOf, turnsOf } from './script.ts'

export type Outcome =
  | { ok: true; result: string; state: AgentState; summary: RunSummary }
  | { ok: false; error: RunError }

export interface Observed {
  outcome: Outcome
  run: LedgerSummary
  observed: LedgerSummary
  probe: { hooks: Record<string, number>; violations: string[] }
  model: { calls: number; pending: number; violations: string[] }
  spans?: SpanStats
}

export function verify(plan: Plan, o: Observed): string[] {
  const { script } = plan
  const failures: string[] = []
  const expect = (ok: boolean, message: string): void => {
    if (!ok) {
      failures.push(message)
    }
  }

  const turns = turnsOf(script)
  const calls = callsOf(script)
  const inputs = script.segments.length + plan.steers + plan.interrupts
  const attempts = plan.attempts.length
  // Calls of an attempt cancelled while its tools ran may or may not have run by the time the interrupt lands
  const maxCalls = calls.length + plan.cancelledCalls
  const between = (n: number | undefined, min: number, max: number): boolean => n !== undefined && n >= min && n <= max

  if (!o.outcome.ok) {
    failures.push(`run failed (${o.outcome.error.kind}) at step ${o.outcome.error.t}: ${o.outcome.error.message}`)
  } else {
    const { result, state, summary } = o.outcome
    expect(result === turns.at(-1)?.text, `result is ${JSON.stringify(clip(result))}, not the last scripted text`)
    failures.push(...compareHistory(expectedHistory(plan), state.messages.map(shapeOf)))

    expect(summary.turns === turns.length, `summary.turns ${summary.turns}, script has ${turns.length}`)
    expect(summary.inputs === inputs, `summary.inputs ${summary.inputs}, script has ${inputs}`)
    for (const [name, want] of Object.entries(countBy(calls.map(c => c.name)))) {
      const got = summary.tools[name]
      expect(got?.calls === want, `summary.tools.${name}.calls ${got?.calls ?? 0}, script has ${want}`)
      expect((got?.errors ?? 0) === 0, `summary.tools.${name}.errors ${got?.errors}`)
    }

    const own = (state.plugins.probe as ProbeCounts | undefined) ?? NO_COUNTS
    const want: ProbeCounts = {
      model: turns.length,
      input: inputs,
      rewrite: 0,
      results: calls.length,
      idle: script.segments.length,
      interrupted: plan.interrupts,
    }
    expect(sameCounts(own, want), `probe state ${JSON.stringify(own)}, expected ${JSON.stringify(want)}`)
  }

  failures.push(...o.run.violations.map(v => `events (for await): ${v}`))
  failures.push(...o.observed.violations.map(v => `events (observe): ${v}`))
  expect(
    o.run.digest === o.observed.digest && o.run.events === o.observed.events,
    `observe saw ${o.observed.events} events, for await saw ${o.run.events}, or in another order`,
  )
  expect(
    o.run.text === plan.text,
    `streamed text (${o.run.text.length} chars) differs from the plan (${plan.text.length} chars)`,
  )
  const cancelled = o.run.byType.step_cancelled ?? 0
  expect(cancelled === plan.interrupts, `${cancelled} steps cancelled for ${plan.interrupts} interrupts`)

  if (o.outcome.ok) {
    const { hooks } = o.probe
    expect(hooks.request === attempts, `request hook ran ${hooks.request} times for ${attempts} model requests`)
    expect(
      between(hooks.toolCall, calls.length, maxCalls),
      `toolCall hook ran ${hooks.toolCall} times for ${calls.length} calls (${maxCalls} with cancelled ones)`,
    )
    expect(hooks.input === inputs, `input hook saw ${hooks.input} messages, script has ${inputs}`)
    expect(
      hooks.record === turns.length + inputs,
      `record ran ${hooks.record} times for ${turns.length + inputs} steps`,
    )
  }
  failures.push(...o.probe.violations.map(v => `probe: ${v}`))

  expect(o.model.calls === attempts, `faux model was called ${o.model.calls} times for ${attempts} requests`)
  expect(o.model.pending === 0, `${o.model.pending} scripted model turns never requested`)
  failures.push(...o.model.violations.slice(0, 20).map(v => `model: ${v}`))

  if (o.spans !== undefined) {
    const s = o.spans
    const ops = s.byOperation
    expect(
      s.started === s.ended && s.endedTwice === 0,
      `spans: ${s.started} started, ${s.ended} ended, ${s.endedTwice} twice`,
    )
    expect(ops.invoke_agent === 1, `spans: ${ops.invoke_agent ?? 0} invoke_agent`)
    expect((ops.chat ?? 0) === attempts, `spans: ${ops.chat ?? 0} chat for ${attempts} model requests`)
    expect(
      between(ops.execute_tool ?? 0, calls.length, maxCalls),
      `spans: ${ops.execute_tool ?? 0} execute_tool for ${calls.length} calls (${maxCalls} with cancelled ones)`,
    )
  }

  return failures
}

/** The part of a message the script determines. */
interface Shape {
  role: Message['role']
  text: string
  calls?: Array<{ id: string; name: string; cmd: unknown }>
  toolCallId?: string
  isError?: boolean
}

function expectedHistory(plan: Plan): Shape[] {
  return plan.steps.flatMap((step): Shape[] =>
    step.kind === 'input'
      ? [{ role: 'user', text: step.text }]
      : [
          {
            role: 'assistant',
            text: step.turn.text,
            calls: step.turn.calls.map(({ id, name, cmd }) => ({ id, name, cmd })),
          },
          ...step.turn.calls.map(c => ({ role: 'toolResult', text: c.obs, toolCallId: c.id, isError: false }) as const),
        ],
  )
}

function shapeOf(m: Message): Shape {
  switch (m.role) {
    case 'user':
      return {
        role: 'user',
        text:
          typeof m.content === 'string' ? m.content : m.content.map(c => (c.type === 'text' ? c.text : '')).join(''),
      }
    case 'assistant':
      return {
        role: 'assistant',
        text: textOf(m),
        calls: callsIn(m).map(c => ({ id: c.id, name: c.name, cmd: c.arguments.cmd })),
      }
    case 'toolResult':
      return {
        role: 'toolResult',
        text: m.content.map(c => (c.type === 'text' ? c.text : '')).join(''),
        toolCallId: m.toolCallId,
        isError: m.isError,
      }
    case 'system':
      // pi-ai's Message union has it for transcripts; a run's history never holds one
      throw new Error('a system message in the history')
  }
}

/** The first message that differs is enough to go on; the rest usually differ because of it. */
function compareHistory(expected: Shape[], actual: Shape[]): string[] {
  const failures: string[] = []
  if (expected.length !== actual.length) {
    failures.push(`history has ${actual.length} messages, script has ${expected.length}`)
  }

  const i = expected.findIndex((e, k) => JSON.stringify(e) !== JSON.stringify(actual[k]))
  if (i !== -1) {
    failures.push(
      `history[${i}] is ${JSON.stringify(clipShape(actual[i]))}, expected ${JSON.stringify(clipShape(expected[i]))}`,
    )
  }
  return failures
}

function sameCounts(a: ProbeCounts, b: ProbeCounts): boolean {
  return (Object.keys(b) as Array<keyof ProbeCounts>).every(key => a[key] === b[key])
}

function countBy(items: string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const item of items) {
    counts[item] = (counts[item] ?? 0) + 1
  }
  return counts
}

function clipShape(s: Shape | undefined): Shape | undefined {
  return s === undefined ? undefined : { ...s, text: clip(s.text) }
}

function clip(text: string, n = 80): string {
  return text.length > n ? `${text.slice(0, n)}…` : text
}
