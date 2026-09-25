# Concepts

**English** · [简体中文](zh-CN/concepts.md)

This page covers the model behind JI. If you only want to use it, read the [README](../README.md) and [Sessions & Runs](sessions-and-runs.md) first.

## One step, three functions

The kernel describes any agent as three functions:

```
π  policy  : S → D* · (A + R)   decide: stream deltas D, then return A or R
ε  env     : A → O              act:    perform the side effect
δ  update  : S × A × O → S      record: compute the next state (sync, pure)
```

`unfold` repeats _decide → act → record_ until the policy returns a result. The output is a lazy stream of events. `extend` wraps any of the three functions in middleware, and that is the only way to extend an agent.

## Three layers

| Layer                      | Responsibility                                                                     | Types                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `@gaoxiang.ai/kernel`      | The `(π, ε, δ)` algebra, `unfold`, `extend`. Knows nothing about LLMs or IO.       | Generic `S, A, O, R, D`                                                  |
| `@gaoxiang.ai/llm` agent   | Implements `(π, ε, δ)` with pi-ai. Compiles plugins into kernel middleware.        | `S = AgentState`, `O = ToolResultMessage[]`, `D = AssistantMessageEvent` |
| `@gaoxiang.ai/llm` session | Drives `unfold`, queues external messages, splits a run into segments on interrupt | `Session`, `Run`                                                         |

## What happens in one step

A **step boundary** is the moment between two steps when no model output is streaming and no tool is running. At each boundary:

```
policy ─┬─ ① input    messages to insert here?  yes → record them, step ends
        │             none and agent idle?       → run finishes
        ├─ ② context  messages to send this time (history unchanged)
        └─ ③ request  call the model, stream deltas
env ───── tool calls of this turn, run in parallel → tool (per call)
update ── append the turn to history → each plugin's state.reduce
```

The agent is **idle** when the history is empty, or the last message is an assistant message with no tool calls.

Every step produces exactly one **Turn**, and `update`, `state.reduce` and `Run.turns` all see the same sequence:

| `turn.kind` | Produced by                                                               | Effect on history         |
| ----------- | ------------------------------------------------------------------------- | ------------------------- |
| `model`     | A model reply plus its tool results. The final answer has `results: []`.  | Appends message + results |
| `input`     | External messages inserted at a boundary (user, steer, follow-up, plugin) | Appends messages          |
| `rewrite`   | `rewriteHistory(messages)` returned from a `policy` middleware            | Replaces history          |

The final answer is recorded before the run ends, so it also goes through `update`.

## Invariants

The design relies on these rules. Breaking one leads to subtle bugs, not a crash.

1. **`update` and `state.reduce` are synchronous and pure.** They must not read clocks or make requests. That is why a saved state reproduces exactly.
2. **Do IO in `policy`, `request`, `env` or `tool`.** For example, compaction writes its summary in `policy`, then hands the replacement to `update` via `rewriteHistory`.
3. **Tool failures are results, not exceptions.** Return `toolError(call, reason)`. Anything thrown is converted to an error result for the model anyway.
4. **Cancellation flows through `yield*`.** In stream middleware, write `return yield* next(...)` so aborts reach the HTTP request and the return value isn't lost.
5. **An interrupted step is never recorded.** State only advances on completed steps.
6. **Plugin state lives in `AgentState`.** Stored as `state.plugins[name]`, it is saved and restored along with the messages.

## Next

- [Writing Plugins](plugins.md): every hook mapped onto the steps above
- [Kernel API](kernel.md): using the algebra directly
