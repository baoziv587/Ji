# Concepts

**English** · [简体中文](zh-CN/concepts.md) · [Documentation index](README.md)

This page covers the model behind JI. If you only want to use it, read the [README](../README.md) and [Sessions & Runs](sessions-and-runs.md) first.

<br>

## Four objects

| Object  | Responsibility                                           | Entry point            |
| ------- | -------------------------------------------------------- | ---------------------- |
| Agent   | Reusable model, tools and plugin configuration           | `createAgent(...)`     |
| Session | One conversation’s state and pending messages            | `createSession(agent)` |
| Run     | Execution until the agent is idle, with output and usage | `chat.send(...)`       |
| Plugin  | Change behavior or observe events at fixed points        | `definePlugin(...)`    |

<br>

## Follow one message

Suppose the user asks the agent to calculate `17 × 23`:

1. **Insert input:** record the user’s message in history.
2. **Decide → act → record:** the model chooses a calculator, the tool returns `391`, and the model message and tool result are recorded together.
3. **Answer → record:** the model gives its final answer. With no tool calls, it goes straight to recording.
4. **Finish:** the agent is idle with no deliverable messages, so the Run completes.

A run contains several steps. Each step that commits state produces one `Turn`; the final idle check and interrupted steps do not produce a committed Turn. Plugins can change individual parts, such as adding retrieved context before `request` or shortening a result after `toolCall`.

<br>

## What happens in one step

A **step boundary** is the moment between two steps when no model output is streaming and no tool is running. At each boundary:

```
decide ───┬─ ① input    messages to insert here?  yes → record them, step ends
          │             none and agent idle?       → run finishes
          └─ ② request  call the model, stream deltas (request hooks may change what it sends; history unchanged)
toolCalls ─ tool calls of this turn, run in parallel → toolCall (per call)
record ──── append the turn to history → each plugin's state.reduce
```

`decide` chooses what this step does; `toolCalls` executes the model’s tool calls; `record` commits the completed Turn. Replies without tool calls skip `toolCalls`. When `decide` returns, tools have not run yet. Every hook in a step reads the same `ctx.state`: the state committed before that step.

The agent is **idle** when the history is empty, or the last message is an assistant message with no tool calls.

Every committed step produces exactly one **Turn**, and `record`, `state.reduce` and `Run.turns` all see the same sequence:

| `turn.kind` | Produced by                                                               | Effect on history         |
| ----------- | ------------------------------------------------------------------------- | ------------------------- |
| `model`     | A model reply plus its tool results. The final answer has `results: []`.  | Appends message + results |
| `input`     | External messages inserted at a boundary (user, steer, follow-up, plugin) | Appends messages          |
| `rewrite`   | `rewriteHistory(messages)` returned from a `decide` middleware            | Replaces history          |

The final answer is recorded before the run ends, so it also goes through `record`.

<br>

## One step, three functions

The kernel describes any agent as three functions:

```
π  policy  : S → D* · (A + R)   decide: stream deltas D, then return A or R
ε  env     : A → D* · O         act:    stream deltas D while performing the side effect, then return O
δ  update  : S × A × O → S      record: compute the next state (sync, pure)
```

Everything with side effects is a stream of the same `D`; everything pure is a plain function. `unfold` repeats _decide → act → record_ until the policy returns a result. The output is a lazy stream of events. `extend` wraps any of the three functions in middleware, and that is the only way to extend an agent.

<br>

## Three layers

| Layer                 | Responsibility                                                                     | Types                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `@ji.dev/kernel`      | The `(π, ε, δ)` algebra, `unfold`, `extend`. Knows nothing about LLMs or IO.       | Generic `S, A, O, R, D`                                                                                                |
| `@ji.dev/llm` agent   | Implements `(π, ε, δ)` with pi-ai. Compiles plugins into kernel middleware.        | `S = AgentState`, `O = ToolResultMessage[]`, `D` = every event: model output, tool start / update / end, plugin events |
| `@ji.dev/llm` session | Drives `unfold`, queues external messages, splits a run into segments on interrupt | `Session`, `Run`                                                                                                       |

<br>

## Invariants

The design relies on these rules. Use them when writing plugins; development checks catch some violations.

1. **`record` and `state.reduce` are synchronous and pure.** They must not read clocks or make requests. The same recorded turns can reconstruct the same state; new model calls may still return different answers. Development checks freeze committed state and run each `state.reduce` twice to catch the common mistakes ([details](plugins.md#development-checks)).
2. **Do IO in `decide`, `input`, `request`, `toolCalls` or `toolCall`, with `ctx.signal`.** For example, compaction writes its summary in `decide` with `ctx.complete`, then hands the replacement to `record` via `rewriteHistory`.
3. **Expected tool failures are results; retryable ones are exceptions.** Return `toolError(call, reason)` for a refusal; throw for a failure a retry may fix, so outer `toolCall` middleware can see it. Anything still thrown is converted to an error result for the model.
4. **Cancellation and events flow through `yield*`.** In stream middleware (`decide`, `request`, `toolCalls`, `toolCall`), write `return yield* next(...)`, or use `before` / `after` / `intercept` / `mapEvents`, so aborts reach the HTTP request and the tools, inner events reach the run, and the return value isn't lost.
5. **An interrupted step is never recorded.** State only advances on completed steps.
6. **Plugin state lives in `AgentState`.** Stored as `state.plugins[name]`, it is saved and restored along with the messages.

<br>

## Next

- [Writing Plugins](plugins.md): every hook mapped onto the steps above
- [Kernel API](kernel.md): using the algebra directly
