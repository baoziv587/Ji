# Writing Plugins

**English** · [简体中文](zh-CN/plugins.md)

A plugin is a named set of hooks. Each hook runs at a fixed point in a step (see [Concepts](concepts.md#what-happens-in-one-step)).

```ts
import { after, before, definePlugin } from '@pi-rsi/llm'

export const myPlugin = definePlugin({
  name: 'my-plugin', // required, unique
  tools: [/* AgentTool */],
  system: prompt => `${prompt}\nBe concise.`,
  input: (messages, { state, idle }) => messages,
  context: (messages, state) => messages,
  request: before(req => ({ ...req, options: { ...req.options, temperature: 0 } })),
  tool: after(result => result),
  update: (state, turn, next) => next(state, turn),
  state: { init: 0, reduce: (n, turn) => n + 1 },
})
```

## Hooks, in execution order

| Hook | Shape | Runs | Typical use |
| --- | --- | --- | --- |
| `tools` | list | At `createAgent` | Register tools |
| `system` | transform | Once, at `createAgent` | Edit the system prompt |
| `policy` | middleware | Wraps the whole step | Compaction, budgets, stopping |
| `input` | transform | At each boundary | Auto-continue, reminders |
| `context` | transform | Before each model call | Retrieval, windowing. History is unchanged. |
| `request` | middleware | Each model call (a stream) | Switch model, temperature, fallback |
| `env` | middleware | All tool calls of one turn | Batch approval. Skipped for turns without tool calls. |
| `tool` | middleware | Each tool call | Truncate, approve, timeout, retry |
| `update` | middleware | Recording every Turn | Trim history. Must be pure. |
| `state` | reducer | After `update` | The plugin's own data. Must be pure. |

Read a plugin's state with `myPlugin.select(state)`. It returns `init` until the plugin has written.

## Two shapes

**Transform:** `(value, context) => value`. Plugins run in array order, each receiving the previous result.

**Middleware:** `(input, next) => output`.

| You... | Effect |
| --- | --- |
| return `next(input)` | No change |
| call `next` with a modified input | Change the input |
| change what `next` returns | Change the output |
| don't call `next` | Intercept |
| call `next` more than once | Retry |

`before(f)` and `after(g)` are shorthands for the input-only and output-only cases. On stream hooks (`request`), `after` forwards deltas unchanged and applies `g` to the final message.

## Ordering

- **Same hook:** later plugins in the `plugins` array are **outer**. They see the input first and the output last.
- **Different hooks:** order is fixed by the step, so plugins that use different hooks can be listed in any order.
- **Presets:** `plugins` accepts nested arrays. Registering the same plugin object twice is not a conflict.

## Rules

1. `update` and `state.reduce` are **synchronous and pure**. Put IO in `policy`, `request`, `env` or `tool`.
2. In `policy` and `request`, consume the stream with **`return yield* next(...)`**. That keeps cancellation and the return value intact.
3. Tools report failure with **`toolError(call, reason)`**, never by throwing.
4. From `policy`, return `rewriteHistory(messages)` to replace history, or `stop(state)` to end the run with the last assistant message.

## Which hook?

| I want to... | Use | Example |
| --- | --- | --- |
| Change tool arguments or results | `tool: before(...)` / `tool: after(...)` | [`truncate-tool-results.ts`](../apps/examples/src/plugins/truncate-tool-results.ts) |
| Approve, block, time out or retry a tool | `tool` | Skip `next` to block |
| Switch model, temperature or thinking | `request: before(...)` | `lowTemperature` in [`hooks.ts`](../apps/examples/src/hooks.ts) |
| Fall back to another model on error | `request` | `fallbackTo` in [`hooks.ts`](../apps/examples/src/hooks.ts) |
| Add retrieval results or send only the last N messages | `context` | `retrieval` in [`hooks.ts`](../apps/examples/src/hooks.ts) |
| Keep going until done, add reminders | `input` | [`keep-going.ts`](../apps/examples/src/plugins/keep-going.ts) |
| Summarize and replace history | `policy` + `rewriteHistory` | [`compaction.ts`](../apps/examples/src/plugins/compaction.ts) |
| Enforce a budget or step cap | `policy` + `stop` | [`budget.ts`](../apps/examples/src/plugins/budget.ts) |
| Trim history (no model call) | `update` | `keepLast` in [`apps/demo`](../apps/demo/src/main.ts) |
| Keep your own counters | `state: { init, reduce }` | [`keep-going.ts`](../apps/examples/src/plugins/keep-going.ts) |
| Measure time, tokens or cost | No plugin: `r.summary`, `r.turns`, `usageOf` | [`metrics.ts`](../apps/examples/src/metrics.ts) |

The plugins under [`apps/examples/src/plugins`](../apps/examples/src/plugins) are meant to be copied and adapted.

## Tools

```ts
import { Type } from '@mariozechner/pi-ai'
import { tool } from '@pi-rsi/llm'

const calc = tool({
  name: 'calc',
  description: 'Evaluate an arithmetic expression.',
  parameters: Type.Object({ expr: Type.String() }),
  run: ({ expr }, signal) => evaluate(expr), // `expr` is inferred as string
})
```

Arguments are validated against the schema before `run`. Tool calls in a single turn run in parallel.
