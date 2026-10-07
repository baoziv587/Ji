// One case as a runnable agent: pi-ai's faux provider speaks the script's model turns, replay tools return the
// recorded observations, and the probe plugin rides along.
//
//   faux response k    checks the request it answers (history length, last role, system prompt), then streams the
//                      turn of attempt k; an interrupted turn is asked for twice, so it has two attempts
//   tool <name>        returns the recorded obs for (name, cmd) in the turn being answered; optionally with latency
//                      and tool_update chunks
//   interjections      sent to the session from the faux response or the first tool call, as the plan says
//
// The model side checks the request because it is the one place that sees exactly what the loop sent.

import type { Context } from '@earendil-works/pi-ai/compat'
import type { Agent, AgentTool, AssistantMessage, PluginList, Run, Session } from '@ji.dev/llm'
import type { Interjection, Interjections, Plan } from './plan.ts'
import type { Probe } from './probe.ts'
import type { ScriptTurn } from './script.ts'
import { setTimeout as sleep } from 'node:timers/promises'
import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  getCurrentSystemPrompt,
  registerFauxProvider,
  withoutInitialSystemMessage,
} from '@earendil-works/pi-ai/compat'
import { createAgent, tool, Type } from '@ji.dev/llm'
import { probe } from './probe.ts'

export interface ReplayOptions {
  /** Faux streaming speed; 0 streams as fast as the event loop allows. */
  tokensPerSecond: number
  /** Each tool call yields its observation in this many tool_update chunks; 0 returns it at once. */
  toolUpdates: number
  /** Simulated time each tool call takes. */
  toolLatencyMs: number
  checkDeterminism: boolean
  interject: Interjections
  /** Added after the probe, so the probe is the outermost middleware. */
  plugins: PluginList
}

export interface Replay {
  agent: Agent
  probe: Probe
  /** What the faux model found wrong in the requests it answered. */
  modelViolations: string[]
  faux: () => { calls: number; pending: number }
  /** The session and Run that interjections go to; the replay sends nothing before this. */
  bind: (session: Session, run: Run) => void
  dispose: () => void
}

export function replay(plan: Plan, modelId: string, options: Omit<ReplayOptions, 'interject'>): Replay {
  const { script } = plan
  const modelViolations: string[] = []
  const faux = registerFauxProvider({
    provider: 'faux',
    models: [{ id: modelId }],
    tokensPerSecond: options.tokensPerSecond > 0 ? options.tokensPerSecond : undefined,
  })

  let target: { session: Session; run: Run } | undefined
  const interject = ({ message, when }: Interjection): void => {
    if (target === undefined) {
      modelViolations.push(`nothing to send "${message}" to: bind was never called`)
      return
    }
    // A message sent while a Run is in progress joins that Run
    const run = target.session.send(message, { when })
    if (run !== target.run) {
      modelViolations.push(`send(when: '${when}') during the run started another Run`)
    }
  }

  const tools = replayTools(plan, options, interject)
  faux.setResponses(
    plan.attempts.map((attempt, k) => (context: Context) => {
      const got = withoutInitialSystemMessage(context.messages)
      if (got.length !== attempt.messages || got.at(-1)?.role !== attempt.lastRole) {
        modelViolations.push(
          `request ${k}: ${got.length} messages ending in ${got.at(-1)?.role}, expected ${attempt.messages} ending in ${attempt.lastRole}`,
        )
      }
      if (getCurrentSystemPrompt(context.messages) !== script.system) {
        modelViolations.push(`request ${k}: system prompt differs from the recording`)
      }

      tools.answering(attempt.turn, attempt.send?.site === 'tool' ? attempt.send : undefined)
      if (attempt.send?.site === 'model') {
        interject(attempt.send)
      }
      return messageOf(attempt.turn)
    }),
  )

  const p = probe()
  const agent = createAgent({
    model: faux.getModel(),
    system: script.system,
    tools: tools.tools,
    plugins: [p.plugin, ...options.plugins],
    checkDeterminism: options.checkDeterminism,
  })

  return {
    agent,
    probe: p,
    modelViolations,
    faux: () => ({ calls: faux.state.callCount, pending: faux.getPendingResponseCount() }),
    bind: (session, run) => {
      target = { session, run }
    },
    dispose: () => faux.unregister(),
  }
}

function messageOf(turn: ScriptTurn): AssistantMessage {
  const calls = turn.calls.map(c => fauxToolCall(c.name, { cmd: c.cmd }, { id: c.id }))
  const content = turn.text === '' ? calls : [fauxText(turn.text), ...calls]
  return fauxAssistantMessage(content, { stopReason: calls.length > 0 ? 'toolUse' : 'stop' })
}

interface ReplayTools {
  tools: AgentTool[]
  /** The faux model has answered with `turn`: its tool calls come next. `send` goes out from the first of them. */
  answering: (turn: ScriptTurn, send?: Interjection) => void
}

/**
 * One tool per recorded function name. A tool knows its arguments, not its call id, so it looks its observation up by
 * (name, cmd) among the calls of the turn the model is answering with; identical calls within a turn share one obs.
 * A turn answered again after an interrupt gets its observations again.
 */
function replayTools(
  plan: Plan,
  { toolUpdates, toolLatencyMs }: Omit<ReplayOptions, 'interject'>,
  interject: (send: Interjection) => void,
): ReplayTools {
  let queues = new Map<string, string[]>()
  let pending: Interjection | undefined

  const answering = (turn: ScriptTurn, send?: Interjection): void => {
    queues = new Map()
    for (const call of turn.calls) {
      const key = keyOf(call.name, call.cmd)
      queues.set(key, [...(queues.get(key) ?? []), call.obs])
    }
    pending = send
  }

  const next = (name: string, cmd: string): string => {
    if (pending !== undefined) {
      const send = pending
      pending = undefined
      interject(send)
    }
    return queues.get(keyOf(name, cmd))?.shift() ?? `no recorded output for ${name}(${cmd})`
  }

  const tools = plan.script.tools.map(name =>
    tool({
      name,
      description: `Replays the recorded output of ${name}`,
      parameters: Type.Object({ cmd: Type.String() }),
      run: ({ cmd }, signal) => {
        const obs = next(name, cmd)
        if (toolUpdates > 0) {
          return streamed(obs, toolUpdates, toolLatencyMs, signal)
        }
        return toolLatencyMs > 0 ? sleep(toolLatencyMs, obs, { signal }) : obs
      },
    }),
  )
  return { tools, answering }
}

/** Yields obs in `parts` chunks spread over `ms`, then returns the whole of it. */
async function* streamed(obs: string, parts: number, ms: number, signal: AbortSignal): AsyncGenerator<string, string> {
  const size = Math.max(1, Math.ceil(obs.length / parts))
  for (let i = 0; i < parts; i++) {
    if (ms > 0) {
      await sleep(ms / parts, undefined, { signal })
    }
    yield obs.slice(i * size, (i + 1) * size)
  }
  return obs
}

function keyOf(name: string, cmd: string): string {
  return `${name}\u0000${cmd}`
}
