# Sessions & Runs

**English** · [简体中文](zh-CN/sessions-and-runs.md)

## The objects

```ts
// stateless, reusable
const agent = createAgent({ model, system, tools, plugins, ...streamOptions })

// one conversation
const chat = createSession(agent, { state, maxSteps })

// one run
const r = chat.send('hi')
```

- **Agent**: model + tools + plugins. It has no state, so one agent can serve many sessions. Duplicate tool or plugin names throw `PluginConflictError`, which lists every conflict.
- **Session**: holds `state` (last recorded state) and `pending` (undelivered messages). Its only method is `send`.
- **Run**: runs from the first step until the agent is idle and no deliverable messages remain.

## Thinking level

`reasoning` is one of pi-ai's stream options; pass it straight to `createAgent`. Leave it unset for no thinking.

```ts
const agent = createAgent({ model, reasoning: 'high' }) // 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
```

Before each model call, the level is checked against the model that request actually uses. A level the model doesn't support becomes the nearest supported one (preferring the higher one), and it is dropped for models that can't think. For example, DeepSeek supports only `high` and `xhigh`, so `'medium'` is sent as `'high'`. Use pi-ai's `getSupportedThinkingLevels(model)` to list the supported levels.

- **Per request:** a `request: before(req => ({ ...req, options: { ...req.options, reasoning: 'xhigh' } }))` plugin. Its level is checked the same way.
- **Mid-conversation:** agents have no state, so continue the same state with a new agent: `createSession(createAgent({ ...options, reasoning: 'xhigh' }), { state: chat.state })`.

## Reading a run

All members share one execution, so you can read several at once.

| Member | Type | Notes |
| --- | --- | --- |
| `r.text` | `AsyncIterable<string>` | Text deltas from the moment you start reading |
| `r.turns` | `AsyncIterable<TurnEvent>` | One record per step: `turn`, `state`, `timing`, running `summary`. **Always replays from step 0.** |
| `r` itself | `AsyncIterable<AgentEvent>` | Raw kernel events, including every model delta (thinking, tool args) |
| `r.result` | `Promise<AssistantMessage>` | Final answer |
| `r.state` | `Promise<AgentState>` | Final state |
| `r.summary` | `Promise<RunSummary>` | Model turns, tokens, cost, model/tool time, per-tool calls/errors/ms |
| `r.abort(reason?)` | | Cancels the run. Undelivered messages stay in the session. |

`result`, `state` and `summary` reject if the run is aborted or fails.

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

## Interjecting while the agent works

`send` while a run is active merges the message into **that same run** and returns the same `Run`. `when` picks the step boundary where the message is inserted:

| `when` | Name | Delivered |
| --- | --- | --- |
| `'idle'` (default) | follow-up | When the agent has finished answering |
| `'step'` | steer | At the next step boundary, e.g. right after the current tools finish |
| `'now'` | interrupt | Cancels the current step now. Its partial output is discarded. |
| `(boundary) => boolean` | custom | Whenever your predicate is true |

```ts
chat.send('use vitest instead', { when: 'step' })
chat.send('then update the changelog') // follow-up
chat.send('stop, outline first', { when: 'now' })
```

**Delivery rule:** at each boundary, pending messages are checked in send order, and each one whose condition holds is inserted. After each insertion the agent is no longer idle, so several follow-ups are handled one by one. That gives the same result as awaiting each run before the next `send`.

## Save and restore

`chat.state` and `r.state` are plain JSON: `{ messages, plugins }`.

```ts
const saved = JSON.stringify(chat.state)
const chat2 = createSession(agent, { state: JSON.parse(saved) })
// or start from a bare message list:
createSession(agent, { state: messages })
```

The plugin list can change between save and restore. A plugin with no saved state starts from its `init`.

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

`timing` includes `ms` and, for model turns, `modelMs`, `firstTokenMs` and `toolMs` keyed by tool call id. `toolMs` in the summary adds up parallel calls, so it can exceed wall time. `usageOf` counts only messages still in history, so compacted messages drop out.
