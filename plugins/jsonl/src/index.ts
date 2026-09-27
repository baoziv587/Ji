// @gaoxiang.ai/plugin-jsonl: every run event as one line of JSON, for replay and debugging (RFC-0005 §4.3)
//
//   createAgent({ model, plugins: [jsonl(line => file.write(line + '\n'))] })
//
//   {"run":"…","session":"…","t":1,"type":"tool_start","call":{…}}
//
//   step_end carries the whole state after the step; it is left out unless asked for, because it grows with the
//   conversation. Errors become { name, message, kind? } so they survive JSON.

import type { Plugin, RunEvent, RunInfo } from '@gaoxiang.ai/llm'
import { definePlugin } from '@gaoxiang.ai/llm'

export interface JsonlOptions {
  /** Include step_end's state. Default false. */
  state?: boolean
}

export function jsonl(write: (line: string) => void, { state = false }: JsonlOptions = {}): Plugin {
  return definePlugin({
    name: 'jsonl',
    observe: (e, run) => write(lineOf(e, run, state)),
  })
}

function lineOf(e: RunEvent, run: RunInfo, withState: boolean): string {
  const record = e.type === 'step_end' && !withState ? withoutState(e) : e
  return JSON.stringify({ run: run.id, session: run.session, ...record }, jsonSafe)
}

function withoutState({ state: _, ...rest }: Extract<RunEvent, { type: 'step_end' }>): object {
  return rest
}

function jsonSafe(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, ...('kind' in value ? { kind: value.kind } : {}) }
  }
  return value
}
