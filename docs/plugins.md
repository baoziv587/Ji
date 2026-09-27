# Writing Plugins

**English** · [简体中文](zh-CN/plugins.md)

A plugin is a named set of hooks into the agent loop. It has the same shape as a Rollup or Vite plugin: an object with a `name`, whose fields are hooks called at fixed points of a pipeline. Here the pipeline is the agent loop, so choosing a hook means choosing where in the loop your code runs, and how often.

```ts
import { after, before, definePlugin } from '@gaoxiang.ai/llm'

export const myPlugin = definePlugin({
  name: 'my-plugin', // required, unique
  tools: [/* AgentTool */],
  system: prompt => `${prompt}\nBe concise.`,
  input: (messages, { state, idle, own }) => messages,
  view: (messages, { state }) => messages,
  request: before(req => ({
    ...req,
    options: { ...req.options, temperature: 0 },
  })),
  toolCall: after(result => result),
  record: (input, next) => next(input),
  state: { init: 0, reduce: (n, turn) => n + 1 },
  observe: (e, run) => log(run.id, e.type),
})
```

## The agent loop

Every hook, where it sits and how often it runs. A run repeats steps until the agent is idle and nothing is queued:

```text
createAgent        tools, system                              once
run                observe                                    every event of the run, in order
 └─ step
     decide        what this step does                        every step
      ├─ input     messages to insert here?                   yes: an input turn, go to record
      │                                                        none and idle: the run ends
      ├─ view      the messages this request sends
      └─ request   one model call                             also every ctx.complete
     toolCalls     all tool calls of the model turn, at once  only turns with tool calls
      └─ toolCall  one call, in parallel with the others      every tool call
     record        writes the turn into history               every step
      └─ state.reduce  each plugin's own data                 as its plugin's record returns
```

`input`, `view` and `request` run inside `decide`: a `decide` that returns `rewriteHistory(...)` or `stop(state)` without calling `next` skips them, and a rewrite goes straight to `record`. The tools do not: when `decide`'s `next` returns, the model has answered but no tool has run yet.

## Hooks

| Hook           | Kind       | Runs                                                 | Yields events | Typical use                                      |
| -------------- | ---------- | ---------------------------------------------------- | ------------- | ------------------------------------------------ |
| `tools`        | list       | At `createAgent`                                     | —             | Register tools                                   |
| `system`       | transform  | Once, at `createAgent`                               | No            | Edit the system prompt                           |
| `decide`       | middleware | Every step                                           | Yes           | Compaction, budgets, stopping                    |
| `input`        | transform  | Every step boundary                                  | No            | Auto-continue, reminders                         |
| `view`         | transform  | Before each main model call                          | No            | Retrieval, windowing. History is unchanged.      |
| `request`      | middleware | Every model call, `ctx.complete`'s too               | Yes           | Switch model, temperature, fallback              |
| `toolCalls`    | middleware | Once per model turn with tool calls: the whole batch | Yes           | Run calls one at a time, approve a batch at once |
| `toolCall`     | middleware | Every tool call, in parallel with the turn's others  | Yes           | Truncate, approve, retry, throttle updates       |
| `record`       | pure       | Every step                                           | No            | Trim history                                     |
| `state.reduce` | pure       | Every step, as its plugin's `record` layer returns   | No            | The plugin's own data                            |
| `observe`      | observer   | Every event of every run                             | No            | Logs, traces, metrics. Read-only.                |

**Kind** says how the hook composes: a transform passes a value down the plugin list, a middleware wraps the layers inside it (`next`), a pure hook is a synchronous function with no `ctx` (it must not do IO), and an observer only watches. **Yields events** says whether the hook can add its own events to the run ([Events from plugins](#events-from-plugins)).

### One call or the whole batch

The names follow one rule: a singular hook wraps one of something, a plural hook wraps the batch. `toolCall` and `toolCalls` sit on either side of the point where a turn's calls start running together:

```text
toolCalls( message )            sees every call of the turn
  └─ run them all at once       the calls start together here
       ├─ toolCall( call a )    sees only its own call
       └─ toolCall( call b )
```

Anything about a single call (its arguments, its result, whether it may run) belongs in `toolCall`. Anything about the calls together belongs in `toolCalls`, because by the time a `toolCall` runs, the calls have already been started side by side and none of them knows about the others: running them one at a time, approving all of them in one prompt, refusing a turn that makes too many calls. [`sequential-tools.ts`](../apps/examples/src/plugins/sequential-tools.ts) hands the calls to `next` one by one; a message holding a single call is a batch of one.

Change history with `record`; keep your own data with `state`. Read a plugin's state from outside with `myPlugin.select(state)`, which returns `init` until the plugin has written. Inside its own hooks, `ctx.own` is the same value.

## Two signatures

```text
transform    (value, ctx) => value | Promise<value>          input, view
middleware   (input, next, ctx) => Stream<Payload, output>   turn, request, toolCalls, toolCall
pure         no ctx                                          system(prompt), record({ state, turn }, next), state.reduce(own, turn)
```

**Transform:** plugins run in list order, each receiving the previous result. It may be async.

**Middleware:**

| You...                            | Effect            |
| --------------------------------- | ----------------- |
| return `next(input)`              | No change         |
| call `next` with a modified input | Change the input  |
| change what `next` returns        | Change the output |
| don't call `next`                 | Intercept         |
| call `next` more than once        | Retry             |

The four middleware with side effects (`decide`, `request`, `toolCalls`, `toolCall`) are **streams**: `yield` adds an event to the run, `return` gives the result, and `yield* next(...)` passes the inner layers' events through. `record` has the same `(input, next)` shape, but it is a plain synchronous function: `record: ({ state, turn }, next) => AgentState`.

## `ctx`

Every hook with a `ctx` gets the same three fields; some get one more.

| Field          | In                    | What it is                                                                                                |
| -------------- | --------------------- | --------------------------------------------------------------------------------------------------------- |
| `ctx.state`    | every hook with a ctx | The state committed before this step. Every hook of a step sees the same snapshot.                        |
| `ctx.own`      | every hook with a ctx | This plugin's state, `plugin.select(ctx.state)`. Its type is inferred from `state.init`.                  |
| `ctx.signal`   | every hook with a ctx | Fires when the step is interrupted or the run is aborted. Pass it to any IO the hook starts.              |
| `ctx.idle`     | `input`               | History is empty, or its last message is an assistant message without tool calls.                         |
| `ctx.complete` | `decide`              | Calls a model through the agent's request chain ([below](#calling-a-model-ctxcomplete)).                  |
| `ctx.by`       | `request`             | The name of the plugin whose `ctx.complete` made this request; `undefined` for the main model's requests. |

A stateful plugin reads its own state without referring to itself or spelling out its type:

```ts
export const keepGoing = ({ isDone, maxTimes = 3, prompt = 'Keep going until the task is done.' }: KeepGoingOptions) =>
  definePlugin({
    name: 'keep-going',
    state: { init: 0, reduce: (n, turn) => (isNudge(turn, prompt) ? n + 1 : n) },
    input: (messages, { state, idle, own }) =>
      idle && messages.length === 0 && !isDone(state) && own < maxTimes ? [user(prompt)] : messages,
  })
```

IO in any hook takes the signal, so an interrupt cancels it instead of letting it run to the end:

```ts
const enrich = definePlugin({
  name: 'enrich',
  async view(messages, { signal }) {
    const response = await fetch('https://example.com/context', { signal })
    return [user(await response.text()), ...messages]
  },
})
```

Never change `ctx.state` or `ctx.own` in place; return new values. With [development checks](#development-checks) on, a write like `ctx.own.count++` throws a `TypeError` at that line.

## Helpers: no generator needed

| I want to...                              | Write             | Needs a generator |
| ----------------------------------------- | ----------------- | ----------------- |
| Change the input                          | `before(f)`       | No                |
| Change the result                         | `after(g)`        | No                |
| Intercept when a condition holds          | `intercept(f)`    | No                |
| Change each event (what readers see only) | `mapEvents(f)`    | No                |
| Yield my own events, retry, call a model  | `async function*` | Yes               |

```text
before(f)     f(input, ctx)         => input | Promise<input>
after(g)      g(output, input, ctx) => output | Promise<output>
intercept(f)  f(input, ctx)         => output | undefined | Promise<output | undefined>
mapEvents(f)  f(event, input, ctx)  => event
```

`intercept` makes a returned value the result without calling `next`, and lets the input through when it returns `undefined`. None of the four streaming hooks can produce `undefined`, so it never means anything else.

```ts
// budget: stop once over the limit
decide: intercept(state => (overBudget(state) ? stop(state) : undefined))

// approval: a refused call gets an error result for the model
toolCall: intercept(async (call, { signal }) =>
  (await askApproval(call, { signal })) ? undefined : toolError(call, 'User denied this call'),
)
```

- `before`, `after` and `intercept` may be async. Once the callback settles they check `ctx.signal`: after the step is cancelled, `next` never starts and no late result is returned. They cannot stop the callback itself, so pass `ctx.signal` to its IO.
- `after` forwards events untouched and maps only the final result. `mapEvents` maps each event one to one, synchronously, and leaves the result alone. Events only reach readers of the run, so to redact both the streamed text and the stored message, use both.
- The helpers are for the four streaming hooks only. `record` is a plain function: `record: (input, next) => trim(next(input))`.

## Calling a model: `ctx.complete`

In `decide`, `ctx.complete(req, { signal? })` calls a model with the agent's own machinery instead of importing pi-ai:

```ts
const summarize = definePlugin({
  name: 'summarize',
  async *decide(state, next, { complete }) {
    if (!tooLong(state.messages)) return yield* next(state)

    const reply = yield* complete({
      systemPrompt: 'Summarize the conversation below for an assistant that will continue it.',
      messages: [user(transcript(state.messages))],
    })
    return rewriteHistory([user(textOf(reply))])
  },
})
```

- Only `messages` is required. `model`, `thinking` and `options` default to the agent's; `systemPrompt` defaults to `''` and `tools` to `[]`. Pass `model: cheapModel` to use a cheaper model.
- It goes through the whole `request` chain, so fallback and other request plugins apply. They see `ctx.by === '<plugin name>'` and can tell it apart from the main model's calls:

  ```ts
  request: before((req, { by }) => (by === undefined ? { ...req, model: mainModel } : req))
  ```

- It is cancelled with the step. Its `thinking`, `text` and `tool_call` events are not streamed, so `r.text` stays the main model's answer. Its `model_start`, `model_end` and `model_error` carry `by: '<plugin name>'`, and its usage counts in `r.summary.usage`.
- One call at a time: running several `complete` calls at once (with `merge`, say) is not supported.
- `request` hooks have no `complete`: the call would go through that very hook again.

The optional `signal` narrows the call: it is merged with the step's signal, so it can cut this one call short but never outlive a cancelled step. A compaction that gives up on the summary after 30 seconds and keeps the long history for this step:

```ts
const compaction = definePlugin({
  name: 'compaction',
  async *decide(state, next, { complete, signal }) {
    if (!tooLong(state.messages)) return yield* next(state)

    const deadline = AbortSignal.timeout(30_000)
    let reply: AssistantMessage
    try {
      const req = { systemPrompt: SUMMARIZE, messages: [user(transcript(state.messages))] }
      reply = yield* complete(req, { signal: deadline })
    } catch (error) {
      // Only our own deadline is ours to handle; a cancelled step or a failing model goes up as usual
      if (signal.aborted || !deadline.aborted) throw error
      return yield* next(state)
    }
    return rewriteHistory([user(textOf(reply)), ...recent(state.messages)])
  },
})
```

The full version, which keeps tool calls paired with their results, is [`compaction.ts`](../apps/examples/src/plugins/compaction.ts).

## Ordering

The plugin list reads top to bottom, outside in:

```text
plugins: [a, b]

transform    input / view          a first, then b
middleware   turn / request / ...  a is outer: a sees the input first and the output last
record       a( b( applyTurn ) )   each state.reduce runs as its layer returns: b's, then a's
observe      a, then b             every event, in list order
```

- **Same hook:** the same as Koa's `app.use(a); app.use(b)`. A budget that must decide before an audit logs anything is `[budget, audit]`. Moving a plugin from `view` to `request: before(...)` keeps its place relative to the others.
- **Different hooks:** order is fixed by the step, so plugins that use different hooks can be listed in any order.
- **Presets:** `plugins` accepts nested arrays. The list is flattened and each plugin object is kept once, where it first appears: `[a, [b, a]]` is `[a, b]`. Its tools, hooks, reducer and observer are registered once, so a shared plugin's state is not counted twice. Two different objects with the same name still throw `PluginConflictError`. The same holds for `agent.with(...)`.

The kernel's `extend(base, m1, m2)` puts `m2` outside; the LLM layer reverses the list before calling it ([Kernel API](kernel.md)).

## Errors and retries

| Case                                                 | What to do                                                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| A tool failure a retry may fix (network, rate limit) | Throw. Outer `toolCall` middleware may retry it; if none does, it becomes an error result for the model.                        |
| An expected refusal or business failure              | Return `toolError(call, reason)`. It is a result: it never reaches a `catch`.                                                   |
| A model request or another hook throws               | It propagates. The run fails with a `RunError` whose `cause` is the original error and whose `state` is the last committed one. |
| The run is aborted or the step interrupted           | Stop. Never retry it, and never turn it into "the tool failed, carry on".                                                       |

Nothing is retried automatically. A retry plugin decides what it retries, how many times and with what backoff, and stops once the signal fires. Retry a tool with side effects (writing, sending, paying) only if it is idempotent. A model fallback must not append a second answer to output the user has already seen: `fallbackTo` in [`hooks.ts`](../apps/examples/src/hooks.ts) only falls back before anything streamed.

```ts
import { setTimeout as delay } from 'node:timers/promises'

const safeToRepeat = new Set(['read_file', 'search_docs'])

const retryReads = definePlugin({
  name: 'retry-reads',
  async *toolCall(call, next, { signal }) {
    for (let attempt = 1; ; attempt++) {
      try {
        return yield* next(call) // an isError result is returned, not retried
      } catch (error) {
        signal.throwIfAborted() // never retry a cancelled run
        if (attempt >= 3 || !safeToRepeat.has(call.name) || !isTransient(error)) throw error
      }
      await delay(100 * 2 ** (attempt - 1), undefined, { signal })
    }
  },
})
```

Both attempts' events stay in the run.

## Observers are synchronous

`observe(e, run)` is called synchronously for every event and never awaited. What it throws is reported as an `ObserveWarning` naming the plugin and the event type; the other observers and the run go on. An observe that returns a promise (`observe: async e => ...`) gets one `ObserveWarning` saying it is not awaited, and its rejections are caught and reported as warnings too. Nothing waits for that work, and nothing orders it.

To export events asynchronously, enqueue them synchronously in `observe`, and flush and close the queue yourself after the run. `r.result` and `run_end` do not mean your export has finished.

```ts
let tail = Promise.resolve()
let pending = 0
const exportErrors: unknown[] = []

const log = definePlugin({
  name: 'queued-log',
  observe(event, run) {
    if (pending >= 1_000) throw new Error('Log queue full; event dropped') // reported as an ObserveWarning
    pending++
    tail = tail
      .then(() => sink.write(event, run))
      .catch(error => {
        exportErrors.push(error)
      })
      .finally(() => {
        pending--
      })
    // Does not return tail: observe only enqueues
  },
})

const session = createSession(createAgent({ model, plugins: [log] }))
try {
  await session.send('Hello').result
} finally {
  await tail // flush: the run is over, so nothing more is enqueued
  try {
    await sink.close()
  } finally {
    for (const error of exportErrors) console.error('Log export failed', error)
  }
}
```

This handles one run of one session. When several sessions share an exporter, flush and close only after all of them are done.

## Development checks

`createAgent({ checkDeterminism })` turns on two cheap checks. The default is on when `NODE_ENV` is `development` or `test`, off otherwise.

1. **Committed state is frozen.** Plain objects and arrays in it are frozen all the way down, so writing to `ctx.state`, `ctx.own` or `record`'s input throws a `TypeError` at the line that does it. `chat.state` and `r.state` are frozen as well: copy before editing. Class instances, Maps and Sets are left alone.
2. **Each `state.reduce` runs twice** on the same input. If the results differ, the plugin gets one `DeterminismWarning` and the first result is kept. The state is written once, so a correct counter still goes up by one.

They catch common mistakes; they do not prove a plugin pure. Two `Date.now()` calls may return the same value, and a reducer that makes a request passes if both answers match (and the request runs twice). `record` is not re-run, since that would run everything behind `next` again.

## Rules

1. `record` and `state.reduce` are **synchronous and pure**. Put IO in `decide`, `input`, `view`, `request`, `toolCalls` or `toolCall`, and pass it `ctx.signal`.
2. In the streaming hooks, consume the stream with **`return yield* next(...)`**, or use a helper. That keeps cancellation, the inner events and the return value intact.
3. Tools **throw** for failures a retry may fix and **return `toolError(call, reason)`** for expected ones ([above](#errors-and-retries)).
4. From `decide`, return `rewriteHistory(messages)` to replace history, or `stop(state)` to end the run with the last assistant message.
5. Never change state in place: return new values.
6. Plugins don't import each other. They share what every plugin can read: `Turn`s, the messages, and event names with their shapes.

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
  async *decide(state, next, { complete }) {
    if (count(state.messages) < limit) return yield* next(state)
    yield { type: 'compaction:start', tokens: count(state.messages) }
    const reply = yield* complete({ systemPrompt: SUMMARIZE, messages: [user(transcript(state.messages))] })
    const messages = [user(textOf(reply))]
    yield { type: 'compaction:end', before: count(state.messages), after: count(messages) }
    return rewriteHistory(messages)
  },
})
```

Readers match on `e.type === 'compaction:start'` without importing the plugin; another plugin that reads it declares the same shape. The event appears exactly where it was yielded: before `next`'s events if yielded before `next`. Events report what happened. To change behavior based on what another plugin did, read the `Turn`s in `state.reduce` (a compaction is a `rewrite` turn, whoever did it), since events are neither saved nor replayed.

## Which hook?

| I want to...                                           | Use                                              | Example                                                                             |
| ------------------------------------------------------ | ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Change tool arguments or results                       | `toolCall: before(...)` / `toolCall: after(...)` | [`truncate-tool-results.ts`](../apps/examples/src/plugins/truncate-tool-results.ts) |
| Approve or block a tool call                           | `toolCall: intercept(...)`                       | Return `toolError(call, reason)` to block                                           |
| Retry a tool                                           | `toolCall`                                       | [Errors and retries](#errors-and-retries)                                           |
| Run a turn's tool calls one at a time                  | `toolCalls`                                      | [`sequential-tools.ts`](../apps/examples/src/plugins/sequential-tools.ts)           |
| Approve all of a turn's tool calls at once             | `toolCalls: intercept(...)`                      | Return one `toolError` per call of `callsOf(message)` to refuse                     |
| Time out a tool                                        | Inside the tool's `run`                          | `AbortSignal.any([signal, AbortSignal.timeout(ms)])`                                |
| Switch model, temperature or thinking                  | `request: before(...)`                           | `lowTemperature` in [`hooks.ts`](../apps/examples/src/hooks.ts)                     |
| Fall back to another model on error                    | `request`                                        | `fallbackTo` in [`hooks.ts`](../apps/examples/src/hooks.ts)                         |
| Rewrite streamed text for display only                 | `request: mapEvents(...)`                        | Redact secrets as they stream                                                       |
| Add retrieval results or send only the last N messages | `view`                                           | `retrieval` in [`hooks.ts`](../apps/examples/src/hooks.ts)                          |
| Keep going until done, add reminders                   | `input`                                          | [`keep-going.ts`](../apps/examples/src/plugins/keep-going.ts)                       |
| Summarize and replace history                          | `decide` + `ctx.complete` + `rewriteHistory`     | [`compaction.ts`](../apps/examples/src/plugins/compaction.ts)                       |
| Enforce a budget or step cap                           | `decide: intercept(...)` + `stop`                | [`budget.ts`](../apps/examples/src/plugins/budget.ts)                               |
| Trim history (no model call)                           | `record`                                         | `keepLast` in [`apps/demo`](../apps/demo/src/main.ts)                               |
| Keep your own counters                                 | `state: { init, reduce }`, read with `ctx.own`   | [`keep-going.ts`](../apps/examples/src/plugins/keep-going.ts)                       |
| Measure time, tokens or cost                           | No plugin: `r.summary`, `r.turns`, `usageOf`     | [`metrics.ts`](../apps/examples/src/metrics.ts)                                     |
| Log, trace or count what happens                       | `observe`                                        | [`plugins/otel`](../plugins/otel), [`plugins/jsonl`](../plugins/jsonl)              |
| Show what a long step is doing                         | `yield` in `decide`, `request` or `toolCall`     | [Events from plugins](#events-from-plugins)                                         |

`budget` counts with `usageOf(state)`, which only sees the main model's messages still in history, so it is not a hard cap on spending: `ctx.complete` calls and compacted messages are left out ([Sessions & Runs](sessions-and-runs.md#metrics-without-plugins)).

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
