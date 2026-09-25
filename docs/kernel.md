# Kernel API

**English** · [简体中文](zh-CN/kernel.md)

`@gaoxiang.ai/kernel` has no dependencies and nothing LLM-specific. Use it directly to build a non-LLM agent or a new layer. Otherwise, [`@gaoxiang.ai/llm`](sessions-and-runs.md) wraps it for you.

| Entry                          | Contents                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| `@gaoxiang.ai/kernel`          | `Agent`, `Extension`, `unfold`, `run`, `extend`, `mapState`, `mapYield`, `act`, `done`   |
| `@gaoxiang.ai/kernel/advanced` | Type-changing transforms: `withState` / `focus`, `widen` / `liftWiden`                   |
| `@gaoxiang.ai/kernel/reduce`   | Composable reducers: `combine`, `mapInput`, `filterInput`, `mapResult`, `reduce`, `scan` |

## Core

```ts
interface Agent<S, A, O, R, D = never> {
  policy: (s: S) => Stream<D, Step<A, R>> // Stream = AsyncGenerator<D, Step>
  env: (a: A) => Promise<O>
  update: (s: S, a: A, o: O) => S // synchronous, pure
}
```

A policy yields any number of deltas `D`, then returns `act(action)` to continue or `done(result)` to stop.

| Function                          | Does                                                                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `unfold(agent, s, maxSteps = 32)` | Lazy stream of events: `delta`, `act` (with `obs` and new `state`) and `done`. Calling `return()` on it cancels all the way down. |
| `run(agent, s, maxSteps?)`        | Folds `unfold` to the final result                                                                                                |
| `extend(agent, ...exts)`          | Applies middleware. **Earlier is inner, later is outer.**                                                                         |
| `mapState(agent, f)`              | Shorthand for an `update` middleware that post-processes state                                                                    |
| `mapYield(stream, f)`             | `yield*` with a map applied to each delta. Keeps the return value and propagates cancellation.                                    |

An `Extension` has up to three middlewares with the same `(input, next)` shape as [LLM plugins](plugins.md#two-shapes).

```ts
const logged = extend(agent, {
  env: async (a, next) => {
    console.log('act', a)
    return next(a)
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
