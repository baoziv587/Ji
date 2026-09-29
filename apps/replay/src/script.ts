// A recorded trajectory -> what the faux model says and what each tool returns, so the agent loop can replay it.
//
//   steps                                   script
//   system* (leading)                       system prompt
//   user+                                   segment input: the first is sent, the rest are queued with when: 'idle'
//   agent, no tools                         text carried into the next model turn
//   agent, tools [t1, t2]                   one model turn: text + tool calls; t1 gets obs, t2 '' (or obs too if
//                                           it is identical to t1: parallel calls may finish in any order)
//   next user, or the end                   closes the segment with a text-only turn, so the agent goes idle
//   system (later)                          dropped: scaffold bookkeeping, not part of the conversation
//
// Every segment ends with a turn without tool calls: that is what makes the agent idle, so the next queued input is
// delivered (or the run ends). When the recording has no text to end on, a synthetic closing turn is added.

import type { Case } from './testkit.ts'

export interface ScriptCall {
  id: string
  name: string
  cmd: string
  obs: string
}

export interface ScriptTurn {
  text: string
  calls: ScriptCall[]
  /** Added to close a segment; not in the recording. */
  synthetic: boolean
}

interface Segment {
  input: string
  turns: ScriptTurn[]
}

export interface Script {
  system: string
  segments: Segment[]
  /** Distinct tool names, in first-use order. */
  tools: string[]
}

export interface ScriptOptions {
  /** Stop reading the recording after this many model turns; the segment in progress is still closed. */
  maxTurns?: number
}

const CLOSING_TEXT = '(end of recorded segment)'

export function toScript(c: Case, { maxTurns = Infinity }: ScriptOptions = {}): Script {
  const system: string[] = []
  const segments: Segment[] = []
  let input: string[] = []
  let turns: ScriptTurn[] = []
  let pending: string[] = []
  let started = false
  let recorded = 0
  let calls = 0

  const closeSegment = (): void => {
    if (pending.length > 0) {
      turns.push({ text: pending.join('\n\n'), calls: [], synthetic: false })
    } else if (turns.length === 0 || turns.at(-1)!.calls.length > 0) {
      turns.push({ text: CLOSING_TEXT, calls: [], synthetic: true })
    }
    segments.push({ input: input.join('\n\n') || `Task: ${c.task}`, turns })
    input = []
    turns = []
    pending = []
  }

  for (const step of c.steps) {
    if (recorded >= maxTurns) {
      break
    }

    if (step.src === 'system') {
      if (!started) {
        system.push(step.msg)
      }
      continue
    }
    started = true

    if (step.src === 'user') {
      if (turns.length > 0 || pending.length > 0) {
        closeSegment()
      }
      input.push(step.msg)
      continue
    }

    if (step.tools.length === 0) {
      if (step.msg !== '') {
        pending.push(step.msg)
      }
      continue
    }

    const text = [...pending, step.msg].filter(s => s !== '').join('\n\n')
    const named = step.tools.map(t => ({ name: toolName(t.fn), cmd: t.cmd }))
    const [first] = named
    turns.push({
      text,
      calls: named.map((t, j) => ({
        id: `call_${calls + j}`,
        ...t,
        // Calls in one turn run at once, in no fixed order: identical calls must get identical results
        obs: t.name === first.name && t.cmd === first.cmd ? (step.obs ?? '') : '',
      })),
      synthetic: false,
    })
    calls += step.tools.length
    pending = []
    recorded++
  }
  closeSegment()

  const tools = [...new Set(segments.flatMap(s => s.turns.flatMap(t => t.calls.map(call => call.name))))]
  return { system: system.join('\n\n'), segments, tools }
}

/** What provider APIs accept as a tool name: [A-Za-z0-9_-], at most 64 characters. */
export function toolName(fn: string): string {
  const name = fn.replaceAll(/[^\w-]/g, '_').slice(0, 64)
  return name === '' ? 'tool' : name
}

export function turnsOf(script: Script): ScriptTurn[] {
  return script.segments.flatMap(s => s.turns)
}

export function callsOf(script: Script): ScriptCall[] {
  return turnsOf(script).flatMap(t => t.calls)
}
