# Writing Plugins

**English** · [简体中文](zh-CN/plugins.md)

A plugin is a named set of hooks. Each hook runs at a fixed point in a step (see [Concepts](concepts.md#what-happens-in-one-step)).

```ts
import { after, before, definePlugin } from '@gaoxiang.ai/llm'

export const myPlugin = definePlugin({
  name: 'my-plugin', // required, unique
  tools: [/* AgentTool */],
  system: prompt => `${prompt}\nBe concise.`,
  input: (messages, { state, idle }) => messages,
  context: (messages, state) => messages,
  request: before(req => ({
    ...req,
    options: { ...req.options, temperature: 0 },
  })),
  tool: after(result => result),
  update: (state, turn, next) => next(state, turn),
  state: { init: 0, reduce: (n, turn) => n + 1 },
  observe: (e, run) => log(run.id, e.type),
})
```

## Hooks, in execution order

| Hook      | Shape      | Runs                                  | Typical use                                           |
| --------- | ---------- | ------------------------------------- | ----------------------------------------------------- |
| `tools`   | list       | At `createAgent`                      | Register tools                                        |
| `system`  | transform  | Once, at `createAgent`                | Edit the system prompt                                |
| `policy`  | middleware | Wraps the whole step                  | Compaction, budgets, stopping                         |
| `input`   | transform  | At each boundary                      | Auto-continue, reminders                              |
| `context` | transform  | Before each model call                | Retrieval, windowing. History is unchanged.           |
| `request` | middleware | Each model call (a stream)            | Switch model, temperature, fallback                   |
| `env`     | middleware | All tool calls of one turn (a stream) | Batch approval. Skipped for turns without tool calls. |
| `tool`    | middleware | Each tool call (a stream)             | Truncate, approve, timeout, retry, throttle updates   |
| `update`  | middleware | Recording every Turn                  | Trim history. Must be pure.                           |
| `state`   | reducer    | After `update`                        | The plugin's own data. Must be pure.                  |
| `observe` | observer   | Every event of every run              | Logs, traces, metrics. Read-only.                     |

Read a plugin's state with `myPlugin.select(state)`. It returns `init` until the plugin has written.

## Two shapes

**Transform:** `(value, context) => value`. Plugins run in array order, each receiving the previous result.

**Middleware:** `(input, next) => output`.

| You...                            | Effect            |
| --------------------------------- | ----------------- |
| return `next(input)`              | No change         |
| call `next` with a modified input | Change the input  |
| change what `next` returns        | Change the output |
| don't call `next`                 | Intercept         |
| call `next` more than once        | Retry             |

The hooks with side effects (`policy`, `request`, `env`, `tool`) are **streams**: `yield` adds an event to the run, `return` gives the result, and `yield* next(...)` passes the inner layers' events through.

```ts
const retry = definePlugin({
  name: 'retry',
  async *tool(ctx, next) {
    try {
      return yield* next(ctx)
    } catch {
      return yield* next(ctx) // both attempts' events stay in the run
    }
  },
})
```

`before(f)` and `after(g)` are shorthands for the input-only and output-only cases. `after` forwards events unchanged and applies `g` to the result, and `mapDeltas(f)` maps each event one to one while leaving the result alone. Events only reach readers of the run, so pair `mapDeltas` with `after` when the stored message should change too.

## Ordering

- **Same hook:** later plugins in the `plugins` array are **outer**. They see the input first and the output last.
- **Different hooks:** order is fixed by the step, so plugins that use different hooks can be listed in any order.
- **Presets:** `plugins` accepts nested arrays. Registering the same plugin object twice is not a conflict.

## Rules

1. `update` and `state.reduce` are **synchronous and pure**. Put IO in `policy`, `request`, `env` or `tool`.
2. In `policy`, `request`, `env` and `tool`, consume the stream with **`return yield* next(...)`**. That keeps cancellation, the inner events and the return value intact.
3. Tools report failure with **`toolError(call, reason)`**, never by throwing.
4. From `policy`, return `rewriteHistory(messages)` to replace history, or `stop(state)` to end the run with the last assistant message.
5. Plugins don't import each other. They share what every plugin can read: `Turn`s, the messages, and event names with their shapes.

## Events from plugins

A plugin yields an event from any stream hook, and registers its type with declaration merging, named `<plugin>:<event>`:

```ts
declare module '@gaoxiang.ai/llm' {
  interface Events {
    'compaction:start': { tokens: number }
    'compaction:end': { before: number; after: number }
  }
}

definePlugin({
  name: 'compaction',
  async *policy(state, next) {
    if (count(state.messages) < limit) return yield* next(state)
    yield { type: 'compaction:start', tokens: count(state.messages) }
    const messages = await summarize(state.messages)
    yield { type: 'compaction:end', before: count(state.messages), after: count(messages) }
    return rewriteHistory(messages)
  },
})
```

Readers match on `e.type === 'compaction:start'` without importing the plugin; another plugin that reads it declares the same shape. The event appears exactly where it was yielded: before `next`'s events if yielded before `next`. Events report what happened. To change behavior based on what another plugin did, read the `Turn`s in `state.reduce` (a compaction is a `rewrite` turn, whoever did it), since events are neither saved nor replayed.

## Which hook?

| I want to...                                           | Use                                          | Example                                                                             |
| ------------------------------------------------------ | -------------------------------------------- | ----------------------------------------------------------------------------------- |
| Change tool arguments or results                       | `tool: before(...)` / `tool: after(...)`     | [`truncate-tool-results.ts`](../apps/examples/src/plugins/truncate-tool-results.ts) |
| Approve, block, time out or retry a tool               | `tool`                                       | Skip `next` to block                                                                |
| Switch model, temperature or thinking                  | `request: before(...)`                       | `lowTemperature` in [`hooks.ts`](../apps/examples/src/hooks.ts)                     |
| Fall back to another model on error                    | `request`                                    | `fallbackTo` in [`hooks.ts`](../apps/examples/src/hooks.ts)                         |
| Rewrite streamed text for display only                 | `request: mapDeltas(...)`                    | Redact secrets as they stream                                                       |
| Add retrieval results or send only the last N messages | `context`                                    | `retrieval` in [`hooks.ts`](../apps/examples/src/hooks.ts)                          |
| Keep going until done, add reminders                   | `input`                                      | [`keep-going.ts`](../apps/examples/src/plugins/keep-going.ts)                       |
| Summarize and replace history                          | `policy` + `rewriteHistory`                  | [`compaction.ts`](../apps/examples/src/plugins/compaction.ts)                       |
| Enforce a budget or step cap                           | `policy` + `stop`                            | [`budget.ts`](../apps/examples/src/plugins/budget.ts)                               |
| Trim history (no model call)                           | `update`                                     | `keepLast` in [`apps/demo`](../apps/demo/src/main.ts)                               |
| Keep your own counters                                 | `state: { init, reduce }`                    | [`keep-going.ts`](../apps/examples/src/plugins/keep-going.ts)                       |
| Measure time, tokens or cost                           | No plugin: `r.summary`, `r.turns`, `usageOf` | [`metrics.ts`](../apps/examples/src/metrics.ts)                                     |
| Log, trace or count what happens                       | `observe`                                    | [`plugins/otel`](../plugins/otel), [`plugins/jsonl`](../plugins/jsonl)              |
| Show what a long step is doing                         | `yield` in `policy`, `request` or `tool`     | [Events from plugins](#events-from-plugins)                                         |

The plugins under [`apps/examples/src/plugins`](../apps/examples/src/plugins) are meant to be copied and adapted. The packages under [`plugins/`](../plugins) are meant to be installed: `otel`, `jsonl` and `throttle-updates`.

## Tools

```ts
import { tool, Type } from '@gaoxiang.ai/llm'

const calc = tool({
  name: 'calc',
  description: 'Evaluate an arithmetic expression.',
  parameters: Type.Object({ expr: Type.String() }),
  run: ({ expr }, signal) => evaluate(expr), // `expr` is inferred as string
})
```

Arguments are validated against the schema before `run`. Tool calls in a single turn run in parallel; their events interleave and their results keep the call order. A `run` written as an async generator reports progress: see [tool updates](sessions-and-runs.md#events).
