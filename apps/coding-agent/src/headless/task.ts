// One task, run to its end without a terminal: the same tools as the screen, running unasked, and the outcome once
// the run ends. What a benchmark runner starts, one session per task (rfcs/bench-gap).

import type { AnyPlugin, Api, Model, RunError, RunSummary, ThinkingLevel } from '@ji.dev/llm'
import type { Feature } from '../features/feature.ts'
import { createSession, textOf } from '@ji.dev/llm'
import { localWorkspace } from '@ji.dev/plugin-files'
import { createLocalExecutor } from '@ji.dev/plugin-shell'
import { createSkillsPlugin } from '@ji.dev/plugin-skills'
import { createPlugins, startAgent } from '../agent/agent.ts'

export interface TaskOptions {
  /** Where the task's files are and where its commands run. */
  root: string
  task: string
  /** 'provider/id' from pi-ai's catalog, or a pi-ai Model for a custom endpoint. */
  model: string | Model<Api>
  thinking: ThinkingLevel
  /** Wall-clock, for the whole run: past it the run is aborted, and every command of its with it. */
  timeoutMs?: number
  /** Steps before the run gives up. No limit by default: `timeoutMs` bounds a task, not a count of steps. */
  maxSteps?: number
  /** The folder of skills, one SKILL.md folder each, the model is told about; none without it. */
  skills?: string
  /** Run after the tools: a log of the events, a budget. */
  plugins?: AnyPlugin[]
  /** Aborts the run from outside, on a SIGTERM say. */
  signal?: AbortSignal
}

/** How the run ended; `summary` counts what was spent either way, so a failed task is still paid for. */
export type TaskOutcome =
  | { outcome: 'done'; text: string; summary: RunSummary; session: string }
  | { outcome: 'failed'; error: RunError; summary: RunSummary; session: string }

/** Runs `task` in `root` and resolves once the run ends; it never rejects over the run itself. */
export async function runTask(options: TaskOptions): Promise<TaskOutcome> {
  const {
    root,
    task,
    model,
    thinking,
    timeoutMs,
    maxSteps = Number.POSITIVE_INFINITY,
    skills,
    plugins = [],
    signal,
  } = options

  const workspace = localWorkspace(root, { allow: () => true })
  const executor = createLocalExecutor({ cwd: root })
  const tools = createPlugins(workspace, executor)
  // The same features as the terminal, in its order, less what asks a person: nobody answers here
  const features: Feature[] = [{ plugin: tools.shell }, { plugin: tools.search }, { plugin: tools.files }]
  if (skills !== undefined) {
    features.push({ plugin: createSkillsPlugin(skills) })
  }
  features.push(...plugins.map(plugin => ({ plugin })))

  const agent = startAgent({ root, model, thinking, features })
  const session = createSession(agent, { maxSteps })
  const run = session.send(task)

  const timer = timeoutMs === undefined ? undefined : setTimeout(() => run.abort(timedOut(timeoutMs)), timeoutMs)
  const stop = (): void => run.abort(signal?.reason)
  signal?.addEventListener('abort', stop, { once: true })

  try {
    // run_end is the last event; leaving the loop on it ends the reading without aborting anything
    for await (const e of run) {
      if (e.type !== 'run_end') {
        continue
      }
      if (e.outcome === 'done') {
        return { outcome: 'done', text: textOf(e.result), summary: e.summary, session: session.id }
      }
      return { outcome: 'failed', error: e.error, summary: e.summary, session: session.id }
    }
    throw new Error('the run ended without a run_end event')
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', stop)
  }
}

function timedOut(ms: number): Error {
  return new Error(`timed out after ${ms / 1000}s`)
}
