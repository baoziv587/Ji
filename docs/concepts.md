# Concepts

**English** · [简体中文](zh-CN/concepts.md)

This page covers the model behind JI. If you only want to use it, read the [README](../README.md) and [Sessions & Runs](sessions-and-runs.md) first.

## One step, three functions

The kernel describes any agent as three functions:

```
π  policy  : S → D* · (A + R)   decide: stream deltas D, then return A or R
ε  env     : A → D* · O         act:    stream deltas D while performing the side effect, then return O
δ  update  : S × A × O → S      record: compute the next state (sync, pure)
```

Everything with side effects is a stream of the same `D`; everything pure is a plain function. `unfold` repeats _decide → act → record_ until the policy returns a result. The output is a lazy stream of events. `extend` wraps any of the three functions in middleware, and that is the only way to extend an agent.

## Three layers

| Layer                      | Responsibility                                                                     | Types                                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `@gaoxiang.ai/kernel`      | The `(π, ε, δ)` algebra, `unfold`, `extend`. Knows nothing about LLMs or IO.       | Generic `S, A, O, R, D`                                                                                                |
| `@gaoxiang.ai/llm` agent   | Implements `(π, ε, δ)` with pi-ai. Compiles plugins into kernel middleware.        | `S = AgentState`, `O = ToolResultMessage[]`, `D` = every event: model output, tool start / update / end, plugin events |
| `@gaoxiang.ai/llm` session | Drives `unfold`, queues external messages, splits a run into segments on interrupt | `Session`, `Run`                                                                                                       |

## What happens in one step

A **step boundary** is the moment between two steps when no model output is streaming and no tool is running. At each boundary:

```
turn ─────┬─ ① input    messages to insert here?  yes → record them, step ends
          │             none and agent idle?       → run finishes
          ├─ ② view     messages to send this time (history unchanged)
          └─ ③ request  call the model, stream deltas
toolCalls ─ tool calls of this turn, run in parallel → toolCall (per call)
record ──── append the turn to history → each plugin's state.reduce
```

`turn`, `toolCalls` and `record` are the plugin hooks around π, ε and δ. The LLM layer names them after what they wrap: π decides this step's Turn (below), ε runs the turn's tool calls (a turn without tool calls, the final answer included, skips it), and δ records the Turn. Every hook of a step reads the same `ctx.state`: the state committed before the step.

The agent is **idle** when the history is empty, or the last message is an assistant message with no tool calls.

Every step produces exactly one **Turn**, and `record`, `state.reduce` and `Run.turns` all see the same sequence:

| `turn.kind` | Produced by                                                               | Effect on history         |
| ----------- | ------------------------------------------------------------------------- | ------------------------- |
| `model`     | A model reply plus its tool results. The final answer has `results: []`.  | Appends message + results |
| `input`     | External messages inserted at a boundary (user, steer, follow-up, plugin) | Appends messages          |
| `rewrite`   | `rewriteHistory(messages)` returned from a `turn` middleware              | Replaces history          |

The final answer is recorded before the run ends, so it also goes through `record`.

## Invariants

The design relies on these rules. Breaking one leads to subtle bugs, not a crash.

1. **`record` and `state.reduce` are synchronous and pure.** They must not read clocks or make requests. That is why a saved state reproduces exactly. Development checks freeze committed state and run each `state.reduce` twice to catch the common mistakes ([details](plugins.md#development-checks)).
2. **Do IO in `turn`, `input`, `view`, `request`, `toolCalls` or `toolCall`, with `ctx.signal`.** For example, compaction writes its summary in `turn` with `ctx.complete`, then hands the replacement to `record` via `rewriteHistory`.
3. **Expected tool failures are results; retryable ones are exceptions.** Return `toolError(call, reason)` for a refusal; throw for a failure a retry may fix, so outer `toolCall` middleware can see it. Anything still thrown is converted to an error result for the model.
4. **Cancellation and events flow through `yield*`.** In stream middleware (`turn`, `request`, `toolCalls`, `toolCall`), write `return yield* next(...)`, or use `before` / `after` / `intercept` / `mapEvents`, so aborts reach the HTTP request and the tools, inner events reach the run, and the return value isn't lost.
5. **An interrupted step is never recorded.** State only advances on completed steps.
6. **Plugin state lives in `AgentState`.** Stored as `state.plugins[name]`, it is saved and restored along with the messages.

## Next

- [Writing Plugins](plugins.md): every hook mapped onto the steps above
- [Kernel API](kernel.md): using the algebra directly
