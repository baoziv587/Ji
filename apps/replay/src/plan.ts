// A script plus the messages a user sends while the agent works (docs/sessions-and-runs.md, "Interjecting"):
//
//   steer      send(msg, { when: 'step' }) during model turn n     inserted after turn n's tool results
//   interrupt  send(msg, { when: 'now' })  during model turn n     turn n is cancelled uncommitted, msg is inserted,
//                                                                  and the model is asked for turn n again
//
// Each is sent from inside the replay at a fixed point, alternating between two sites: while the model is answering
// (from the faux response) or while a tool runs (from the first tool call). That makes the result exact, so the
// plan can say what every request, the history, the streamed text and the counts must be.
//
//   segment input        -> input step (idle)
//   turn n, interrupted  -> attempt (cancelled) -> input step (interrupted) -> attempt -> model step
//   turn n, steered      -> attempt -> model step -> input step
//
// Steering only goes on turns with tool calls: after a turn without them the agent is idle, and the next segment's
// queued input would be delivered at the same boundary.

import type { Script, ScriptTurn } from './script.ts'

export interface Interjections {
  /** Steer during every n-th model turn; 0 never does. */
  steer: number
  /** Interrupt every n-th model turn; 0 never does. */
  interrupt: number
}

const NO_INTERJECTIONS: Interjections = { steer: 0, interrupt: 0 }

export interface Interjection {
  when: 'step' | 'now'
  /** Sent from the faux response ('model') or from the turn's first tool call ('tool'). */
  site: 'model' | 'tool'
  message: string
}

/** One request to the faux model: the turn it answers with, and the history it must arrive with. */
interface Attempt {
  turn: ScriptTurn
  messages: number
  lastRole: 'user' | 'toolResult'
  send?: Interjection
}

/** A committed step. */
type PlannedStep =
  | { kind: 'input'; text: string; idle: boolean; interrupted: boolean }
  | { kind: 'model'; turn: ScriptTurn }

export interface Plan {
  script: Script
  attempts: Attempt[]
  steps: PlannedStep[]
  /** What the main model streams, cancelled attempts included. */
  text: string
  steers: number
  interrupts: number
  /** Tool calls of attempts cancelled while their tools ran; some may run before the interrupt lands. */
  cancelledCalls: number
}

export function planOf(script: Script, { steer, interrupt }: Interjections = NO_INTERJECTIONS): Plan {
  const attempts: Attempt[] = []
  const steps: PlannedStep[] = []
  const text: string[] = []
  let history = 0
  let lastRole: Attempt['lastRole'] = 'user'
  let n = 0
  let steers = 0
  let interrupts = 0
  let cancelledCalls = 0

  const input = (message: string, idle: boolean, interrupted: boolean): void => {
    steps.push({ kind: 'input', text: message, idle, interrupted })
    history += 1
    lastRole = 'user'
  }

  for (const segment of script.segments) {
    input(segment.input, true, false)

    for (const turn of segment.turns) {
      n++

      if (every(interrupt, n)) {
        const site = interrupts % 2 === 1 && turn.calls.length > 0 ? 'tool' : 'model'
        const message = `(interrupt ${++interrupts}) Stop, and take another look before going on.`
        attempts.push({ turn, messages: history, lastRole, send: { when: 'now', site, message } })
        if (site === 'tool') {
          // The model has finished answering when a tool runs
          text.push(turn.text)
          cancelledCalls += turn.calls.length
        }
        input(message, false, true)
      }

      const steered = every(steer, n) && turn.calls.length > 0
      const message = `(steer ${steers + 1}) Keep going, and keep it short.`
      const send: Interjection | undefined = steered
        ? { when: 'step', site: steers % 2 === 0 ? 'model' : 'tool', message }
        : undefined
      attempts.push({ turn, messages: history, lastRole, send })
      text.push(turn.text)
      steps.push({ kind: 'model', turn })
      history += 1 + turn.calls.length
      lastRole = 'toolResult'

      if (steered) {
        steers++
        input(message, false, false)
      }
    }
  }

  return { script, attempts, steps, text: text.join(''), steers, interrupts, cancelledCalls }
}

function every(n: number, k: number): boolean {
  return n > 0 && k % n === 0
}
