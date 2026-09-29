// One case as a runnable agent: pi-ai's faux provider speaks the script's model turns, replay tools return the
// recorded observations, and the probe plugin rides along.
//
//   faux response k    checks the request it answers (history length, last role, system prompt), then streams turn k
//   tool <name>        returns the next recorded obs for (name, cmd); optionally with latency and tool_update chunks
//
// The model side checks the request because it is the one place that sees exactly what the loop sent.

import type { Agent, AgentTool, AssistantMessage, PluginList } from '@ji.dev/llm'
import type { Context } from '@mariozechner/pi-ai'
import type { Probe } from './probe.ts'
import type { Script, ScriptTurn } from './script.ts'
import { setTimeout as sleep } from 'node:timers/promises'
import { createAgent, tool, Type } from '@ji.dev/llm'
import { fauxAssistantMessage, fauxText, fauxToolCall, registerFauxProvider } from '@mariozechner/pi-ai'
import { probe } from './probe.ts'
import { callsOf } from './script.ts'

export interface ReplayOptions {
  /** Faux streaming speed; 0 streams as fast as the event loop allows. */
  tokensPerSecond: number
  /** Each tool call yields its observation in this many tool_update chunks; 0 returns it at once. */
  toolUpdates: number
  /** Simulated time each tool call takes. */
  toolLatencyMs: number
  checkDeterminism: boolean
  /** Added after the probe, so the probe is the outermost middleware. */
  plugins: PluginList
}

export interface Replay {
  agent: Agent
  probe: Probe
  /** What the faux model found wrong in the requests it answered. */
  modelViolations: string[]
  faux: () => { calls: number; pending: number }
  dispose: () => void
}

export function replay(script: Script, modelId: string, options: ReplayOptions): Replay {
  const modelViolations: string[] = []
  const faux = registerFauxProvider({
    provider: 'faux',
    models: [{ id: modelId }],
    tokensPerSecond: options.tokensPerSecond > 0 ? options.tokensPerSecond : undefined,
  })

  const expected = requestShapes(script)
  faux.setResponses(
    expected.map(({ turn, messages, lastRole }, k) => (context: Context) => {
      const got = context.messages
      if (got.length !== messages || got.at(-1)?.role !== lastRole) {
        modelViolations.push(
          `request ${k}: ${got.length} messages ending in ${got.at(-1)?.role}, expected ${messages} ending in ${lastRole}`,
        )
      }
      if ((context.systemPrompt ?? '') !== script.system) {
        modelViolations.push(`request ${k}: system prompt differs from the recording`)
      }
      return messageOf(turn)
    }),
  )

  const p = probe()
  const agent = createAgent({
    model: faux.getModel(),
    system: script.system,
    tools: replayTools(script, options),
    plugins: [p.plugin, ...options.plugins],
    checkDeterminism: options.checkDeterminism,
  })

  return {
    agent,
    probe: p,
    modelViolations,
    faux: () => ({ calls: faux.state.callCount, pending: faux.getPendingResponseCount() }),
    dispose: () => faux.unregister(),
  }
}

interface RequestShape {
  turn: ScriptTurn
  /** History length the request must carry. */
  messages: number
  lastRole: 'user' | 'toolResult'
}

/** Each model turn in order, with the history the loop must have sent to get it. */
function requestShapes(script: Script): RequestShape[] {
  const shapes: RequestShape[] = []
  let history = 0

  for (const segment of script.segments) {
    history += 1
    let lastRole: RequestShape['lastRole'] = 'user'
    for (const turn of segment.turns) {
      shapes.push({ turn, messages: history, lastRole })
      history += 1 + turn.calls.length
      lastRole = 'toolResult'
    }
  }
  return shapes
}

function messageOf(turn: ScriptTurn): AssistantMessage {
  const calls = turn.calls.map(c => fauxToolCall(c.name, { cmd: c.cmd }, { id: c.id }))
  const content = turn.text === '' ? calls : [fauxText(turn.text), ...calls]
  return fauxAssistantMessage(content, { stopReason: calls.length > 0 ? 'toolUse' : 'stop' })
}

/**
 * One tool per recorded function name. A tool knows its arguments, not its call id, so observations queue up per
 * (name, cmd) in script order: turns run one after another, and identical calls within a turn share one obs.
 */
function replayTools(script: Script, { toolUpdates, toolLatencyMs }: ReplayOptions): AgentTool[] {
  const queues = new Map<string, string[]>()
  for (const call of callsOf(script)) {
    const key = keyOf(call.name, call.cmd)
    queues.set(key, [...(queues.get(key) ?? []), call.obs])
  }

  const next = (name: string, cmd: string): string =>
    queues.get(keyOf(name, cmd))?.shift() ?? `no recorded output for ${name}(${cmd})`

  return script.tools.map(name =>
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
