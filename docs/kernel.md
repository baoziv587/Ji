# Kernel API

**English** · [简体中文](zh-CN/kernel.md) · [Documentation index](README.md)

`@gaoxiang.ai/kernel` has no dependencies and nothing LLM-specific. Use it directly to build a non-LLM agent or a new layer. Otherwise, [`@gaoxiang.ai/llm`](sessions-and-runs.md) wraps it for you.

| Entry                          | Contents                                                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `@gaoxiang.ai/kernel`          | `Agent`, `Extension`, `unfold`, `run`, `extend`, `mapState`, `mapYield`, `merge`, `act`, `done`, `MaxStepsError` |
| `@gaoxiang.ai/kernel/advanced` | Type-changing transforms: `withState` / `focus`, `widen` / `liftWiden`                                           |
| `@gaoxiang.ai/kernel/reduce`   | Composable reducers: `combine`, `mapInput`, `filterInput`, `mapResult`, `reduce`, `scan`                         |

## Run a minimal loop

This agent counts from `0` to `3`. `policy` chooses the next action, `env` executes it, and `update` records the result. `run` consumes the loop and returns `3`:

```ts
import type { Agent } from '@gaoxiang.ai/kernel'
import { act, done, run } from '@gaoxiang.ai/kernel'

const counter: Agent<number, number, number, number> = {
  async *policy(state) {
    return state < 3 ? act(state + 1) : done(state)
  },
  async *env(action) {
    return action
  },
  update: (_state, _action, observation) => observation,
}

console.log(await run(counter, 0)) // 3
```

## Core

```ts
interface Agent<S, A, O, R, D = never> {
  policy: (s: S) => Stream<D, Step<A, R>> // Stream = AsyncGenerator<D, Step>
  env: (a: A) => Stream<D, O>
  update: (s: S, a: A, o: O) => S // synchronous, pure
}
```

A policy yields any number of deltas `D`, then returns `act(action)` to continue or `done(result)` to stop. An env yields deltas of the same type while it works, then returns the observation. Everything with side effects is a stream; `update` is a plain function. An env with nothing to report is `async function* (a) { return o }`.

| Function                          | Does                                                                                                                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unfold(agent, s, maxSteps = 32)` | Lazy stream of events: `delta` (from policy, then env), `act` (with `obs` and new `state`) and `done`. Calling `return()` on it cancels all the way down, into env too. Throws `MaxStepsError` past `maxSteps`. |
| `run(agent, s, maxSteps?)`        | Folds `unfold` to the final result                                                                                                                                                                              |
| `extend(agent, ...exts)`          | Applies middleware. **Earlier is inner, later is outer.**                                                                                                                                                       |
| `mapState(agent, f)`              | Shorthand for an `update` middleware that post-processes state                                                                                                                                                  |
| `mapYield(stream, f)`             | `yield*` with a map applied to each delta. Keeps the return value and propagates cancellation.                                                                                                                  |
| `merge(streams)`                  | Runs streams at once: deltas in arrival order, results in source order. Cancelling it closes every source that started.                                                                                         |

An `Extension` has up to three middlewares with the same `(input, next)` shape as [LLM plugins](plugins.md#hook-signatures).

```ts
const logged = extend(agent, {
  async *env(a, next) {
    console.log('act', a)
    return yield* next(a)
  },
})
```

## Changing type parameters (`/advanced`)

Each transform comes with a _lift_ that moves existing middleware onto the new type, so that

```
transform(extend(a, x)) ≃ extend(transform(a), lift(x))
```

That means code can always be written as `extend(transform(base), ...extensions)`.

| Transform                                     | Lift                    | Use                                                                       |
| --------------------------------------------- | ----------------------- | ------------------------------------------------------------------------- |
| `withState(agent, lens)`: `S → T`             | `focus(ext, lens)`      | Embed an agent in a larger state. The middleware only sees its own slice. |
| `widen(agent, isNew, handlers)`: `A → A \| N` | `liftWiden(ext, isNew)` | Add a new kind of action, emitted by an outer middleware                  |

A `Lens<T, S>` must satisfy the three lens laws: get-set, set-get and set-set. `@gaoxiang.ai/llm` also uses `Lens` for plugin state: its `pluginStateSlot(name, init)` is a lens onto `state.plugins[name]`: `plugin.select` is its `get`, and the state reducer writes through its `set`. `liftWiden` only accepts `env`/`update` middleware. A policy middleware's output mentions `A`, so there is no general lift for it, and the types reject it.

## Reducers (`/reduce`)

```ts
interface Reducer<In, Acc, Out = Acc> {
  init: Acc
  reduce: (acc: Acc, x: In) => Acc
  result?: (acc: Acc) => Out
}
```

`combine({ a: r1, b: r2 })` computes several reducers in one pass. `scan` yields every intermediate result. `@gaoxiang.ai/llm` builds `Run.summary` and plugin state this way. As with `update`, `reduce` must be synchronous and pure.

## Next

[Concepts](concepts.md) · [Writing LLM plugins](plugins.md) · [Documentation index](README.md)
