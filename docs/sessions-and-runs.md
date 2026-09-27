# Sessions & Runs

**English** · [简体中文](zh-CN/sessions-and-runs.md) · [Documentation index](README.md)

Start with one conversation, then add event handling, interjections and persistence as needed. These examples assume you have selected a `model` and configured its API key.

## Send and read an answer

```ts
import { createAgent, createSession } from '@gaoxiang.ai/llm'

const agent = createAgent({ model, system: 'Be concise.' })
const chat = createSession(agent)
const r = chat.send('Hello')

for await (const chunk of r.text) process.stdout.write(chunk)
console.log(await r.summary)
```

`send` returns a Run. Text arrives through `r.text`; `r.summary` resolves with usage when execution finishes. For only the final answer, use `await chat.send('Hello').result`.

Leaving any stream loop early cancels the whole run; see [Cancellation](#cancellation) for recovery.

## The objects

```ts
// stateless, reusable
const agent = createAgent({ model: 'deepseek/deepseek-v4-flash', thinking, system, tools, plugins, ...streamOptions })

// one conversation
const chat = createSession(agent, { state, maxSteps })

// one run
const r = chat.send('hi')
```

- **Agent**: model + tools + plugins. It has no state, so one agent can serve many sessions. Mistakes surface here, not at the first request: an unknown model throws `UnknownModelError` (with the closest match), an unsupported thinking level throws `UnsupportedThinkingError` (with the supported ones), and duplicate tool or plugin names throw `PluginConflictError`, which lists every conflict.
- **Session**: holds `state` (last recorded state) and `pending` (undelivered messages). Its methods are `send` and `use`.
- **Run**: runs from the first step until the agent is idle and no deliverable messages remain.

## Reading a run

All members share one execution, so you can read several at once.

| Member             | Type                        | Notes                                                                                              |
| ------------------ | --------------------------- | -------------------------------------------------------------------------------------------------- |
| `r.text`           | `AsyncIterable<string>`     | Text deltas from the moment you start reading                                                      |
| `r.turns`          | `AsyncIterable<TurnEvent>`  | One record per step: `turn`, `state`, `timing`, running `summary`. **Always replays from step 0.** |
| `r` itself         | `AsyncIterable<RunEvent>`   | Every event of the run in order, one `type` each ([below](#events))                                |
| `r.result`         | `Promise<AssistantMessage>` | Final answer                                                                                       |
| `r.state`          | `Promise<AgentState>`       | Final state                                                                                        |
| `r.summary`        | `Promise<RunSummary>`       | Model turns, tokens, cost (plugin model calls included), model/tool time, per-tool calls/errors/ms |
| `r.abort(reason?)` |                             | Cancels the run. Undelivered messages stay in the session.                                         |

`result`, `state` and `summary` reject with a `RunError` if the run is aborted or fails. It carries `kind` (`'aborted'`, `'max_steps'`, `'provider'`, `'internal'`), the step `t`, the last committed `state` to resume from, and the original error as `cause`.

```ts
const r = chat.send('refactor utils.ts')

const printing = (async () => {
  for await (const chunk of r.text) process.stdout.write(chunk)
})()

for await (const { t, turn, timing, summary } of r.turns) {
  statusBar.set(`step ${t} · ${timing.ms}ms · $${summary.usage.cost}`)
}
await printing
```

## Cancellation

- Leaving any `for await` early, by `break` or by throwing, **aborts the whole run**.
- `r.abort()` does the same explicitly.
- The abort signal reaches both the in-flight model request and the running tools. Tools get it as `run(args, signal)`.

Cancellation stops further execution; it does not undo tool side effects that already happened. The unfinished step is not committed. Mark any text already displayed as interrupted in your UI. Tools must pass their `signal` to IO so that work can stop promptly.

Recover from the last committed state after a failure:

```ts
import { RunError } from '@gaoxiang.ai/llm'

try {
  await chat.send('Continue the task').result
} catch (error) {
  if (!(error instanceof RunError)) throw error
  console.error(error.kind, error.message)
  const recovered = createSession(agent, { state: error.state })
  // Save recovered.state or send a new instruction when ready.
}
```

Restoring state does not automatically retry the failed step. Undelivered messages remain in the original session’s `chat.pending`; they are outside the snapshot and are not copied into the new session.

## Interjecting while the agent works

`send` while a run is active merges the message into **that same run** and returns the same `Run`. `when` picks the step boundary where the message is inserted:

| `when`                  | Name      | Delivered                                                                     |
| ----------------------- | --------- | ----------------------------------------------------------------------------- |
| `'idle'` (default)      | follow-up | When the agent has finished answering                                         |
| `'step'`                | steer     | At the next step boundary, e.g. right after the current tools finish          |
| `'now'`                 | interrupt | Cancels the current step now. Its partial output is not committed to history. |
| `(boundary) => boolean` | custom    | Whenever your predicate is true                                               |

```ts
chat.send('use vitest instead', { when: 'step' })
chat.send('then update the changelog') // follow-up
chat.send('stop, outline first', { when: 'now' })
```

**Delivery rule:** at each boundary, pending messages are checked in send order, and each one whose condition holds is inserted. After each insertion the agent is no longer idle, so several follow-ups are handled one by one. That gives the same result as awaiting each run before the next `send`.

## Save and restore

`chat.state` is the latest committed JSON snapshot: `{ messages, plugins }`. Use `await r.state` for the snapshot after a successful run. Pending messages are not included.

```ts
const saved = JSON.stringify(chat.state)
const chat2 = createSession(agent, { state: JSON.parse(saved) })
// or start from a bare message list:
createSession(agent, { state: messages })
```

The plugin list can change between save and restore. A plugin with no saved state starts from its `init`.

## Model and thinking level

`model` is a `'provider/id'` from pi-ai's catalog, or a pi-ai `Model` object for anything else (a custom `baseUrl`, the faux provider). The agent knows what the model accepts, so you never need pi-ai to ask:

```ts
const agent = createAgent({ model: 'deepseek/deepseek-v4-flash', thinking: 'high' })
agent.model.thinkingLevels // ['off', 'high', 'xhigh']
agent.thinking // 'high'
agent.model.hasEnvKey // is DEEPSEEK_API_KEY set right now?
```

`thinking` is `'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'`. It defaults to `'off'`, or to the lightest level for a model that always thinks. A level the model does not accept throws at `createAgent`; nothing is mapped silently. `findModel(spec)` and `listModels(provider?)` give the same information before you build an agent, for a model picker.

- **Mid-conversation:** `chat.use(agent.with({ thinking: 'xhigh' }))`. `with` returns a new agent and leaves the old one as it is; `use` switches at the next step boundary and keeps the state, the queued messages and the run in progress.
- **Per request:** a `request: before(req => ({ ...req, thinking: 'xhigh' }))` plugin. A plugin may also switch the model, so this level is mapped to the nearest one the request's model supports, and the level actually sent is reported in `model_start`.
- **API key:** nothing checks it for you, since a key can also come from `apiKey` or a request plugin. Check `agent.model.hasEnvKey` when the user is about to send, not before.

## Limits

`maxSteps` (default 64) caps the steps in one run. Inserting messages and finishing each count as a step. A run that exceeds the limit fails.

## Metrics without plugins

```ts
for await (const { timing, summary } of r.turns) {
  // per step + running totals
}
const { turns, usage, modelMs, toolMs, tools } = await r.summary // this run
usageOf(chat.state) // whole conversation
```

`timing` includes `ms` and, for model turns, `modelMs`, `firstTokenMs` and `toolMs` keyed by tool call id, all computed from the events (so `toolMs[id]` equals that call's `tool_end.ms`). `toolMs` in the summary adds up parallel calls, so it can exceed wall time. `r.summary.usage` and `usageOf` count different things, so they need not agree:

- `r.summary.usage` sums the usage of every `model_end` and `model_error` published in this run, plugin `ctx.complete` calls included. A step that is later cancelled, stopped or rewritten keeps what it already spent. A call cut off by an interrupt reports no usage, so it is not counted.
- `usageOf(state)` sums the main model's messages still in history. Plugin calls and compacted messages drop out.

## Events

Reading `r` gives one flat stream; switch on `e.type`. Each event also has the step number `t`.

| Event                     | When                                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| `step_start` / `step_end` | A step begins / is recorded. `step_end` is the same record as `r.turns`.                       |
| `step_cancelled`          | A step was interrupted or aborted before being recorded. `open` lists the calls still running. |
| `model_start`             | A request is sent: the model and the thinking level actually used, and `by` (below)            |
| `thinking` / `text`       | The main model's output, as `delta`                                                            |
| `tool_call`               | The model finished writing a call's arguments. **The tool has not started.**                   |
| `model_end`               | The call succeeded: the complete message, with usage and `ms`                                  |
| `model_error`             | The call failed: `error`, the provider's `usage` if any, and `ms`. A request plugin may retry. |
| `tool_start` / `tool_end` | A call really starts / has its result, with `ms`. Parallel calls end in completion order.      |
| `tool_update`             | A value the tool yielded (below)                                                               |
| `run_end`                 | The run is over: `outcome` is `'done'` with the result, or `'failed'` with the `RunError`      |
| `<plugin>:<event>`        | Whatever a plugin yields ([Writing Plugins](plugins.md#events-from-plugins))                   |

Every `tool_start` is closed by its `tool_end` or by the step's `step_cancelled`, so a UI never keeps a spinner forever. Likewise every `model_start` is closed by exactly one `model_end`, `model_error` or `step_cancelled`, and at most one model call is open at a time, so they pair up in order.

**`by`.** A plugin may call a model itself with [`ctx.complete`](plugins.md#calling-a-model-ctxcomplete), for a summary, say. Those calls' `model_start`, `model_end` and `model_error` carry `by: '<plugin name>'`; the main model's have no `by`. Their `thinking`, `text` and `tool_call` are not streamed, so `r.text` is only ever the main answer.

```ts
for await (const e of r) {
  switch (e.type) {
    case 'text':
      process.stdout.write(e.delta)
      break
    case 'tool_start':
      ui.spin(e.call.id, e.call.name)
      break
    case 'tool_update':
      ui.progress(e.call.id, e.data)
      break
    case 'tool_end':
      ui.done(e.call.id, e.result)
      break
  }
}
```

**Tool updates.** A tool whose `run` is an async generator reports as it goes: every `yield` becomes a `tool_update` (any value: a number, a string, an object), and what it returns is the result. On cancel, its `finally` runs.

```ts
const runTests = tool({
  name: 'run_tests',
  description: 'Run the test files matching a glob.',
  parameters: Type.Object({ pattern: Type.String() }),
  async *run({ pattern }, signal) {
    const files = await glob(pattern)
    for (const [i, file] of files.entries()) {
      yield { message: file, done: i, total: files.length }
      await runFile(file, signal)
    }
    return `${files.length} files passed`
  },
})
```

**Logging and tracing.** A `for await` loop that throws or leaves early aborts the run, and it sees only one run. For logs, traces and metrics use a plugin's read-only `observe` hook instead: it gets every event of every run of the agent from the first one, and what it throws is reported as a warning without touching the run. `observe` is synchronous and never awaited: to export asynchronously, enqueue in `observe` and flush after the run ([example](plugins.md#observers-are-synchronous)). Ready-made: `@gaoxiang.ai/plugin-otel` and `@gaoxiang.ai/plugin-jsonl` in [`plugins/`](../plugins).

## Next

[Writing Plugins](plugins.md) · [Concepts](concepts.md) · [Documentation index](README.md)
