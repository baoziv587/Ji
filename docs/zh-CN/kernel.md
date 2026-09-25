# 内核 API

[English](../kernel.md) · **简体中文**

`@gaoxiang.ai/kernel` 零依赖，与 LLM 无关。写非 LLM 的 agent、或者搭新的一层时直接使用；其他情况下，[`@gaoxiang.ai/llm`](sessions-and-runs.md) 已经把它包装好了。

| 入口                           | 内容                                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| `@gaoxiang.ai/kernel`          | `Agent`、`Extension`、`unfold`、`run`、`extend`、`mapState`、`mapYield`、`act`、`done` |
| `@gaoxiang.ai/kernel/advanced` | 改变类型参数的变换：`withState` / `focus`、`widen` / `liftWiden`                       |
| `@gaoxiang.ai/kernel/reduce`   | 可组合的 reducer：`combine`、`mapInput`、`filterInput`、`mapResult`、`reduce`、`scan`  |

## 核心

```ts
interface Agent<S, A, O, R, D = never> {
  policy: (s: S) => Stream<D, Step<A, R>> // Stream = AsyncGenerator<D, Step>
  env: (a: A) => Promise<O>
  update: (s: S, a: A, o: O) => S // 同步、纯
}
```

policy 先产出任意多个增量 `D`，然后返回 `act(action)` 继续，或者返回 `done(result)` 结束。

| 函数                              | 作用                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------- |
| `unfold(agent, s, maxSteps = 32)` | 惰性事件流：`delta`、`act`（带 `obs` 和新的 `state`）、`done`。对它调用 `return()` 会一路取消到底 |
| `run(agent, s, maxSteps?)`        | 把 `unfold` 折叠成最终结果                                                                        |
| `extend(agent, ...exts)`          | 套上中间件。**先出现的在内层，后出现的在外层**                                                    |
| `mapState(agent, f)`              | 对状态做后处理的 `update` 中间件简写                                                              |
| `mapYield(stream, f)`             | 带 map 的 `yield*`：变换每个增量，保留返回值，并传递取消                                          |

一个 `Extension` 最多包含三个中间件，形状和 [LLM 插件](plugins.md#两种形状) 一样，都是 `(input, next)`。

```ts
const logged = extend(agent, {
  env: async (a, next) => {
    console.log('act', a)
    return next(a)
  },
})
```

## 改变类型参数（`/advanced`）

每个变换都配有一个提升函数（lift），能把已有的中间件搬到新类型上，并满足

```
transform(extend(a, x)) ≃ extend(transform(a), lift(x))
```

所以代码总能写成 `extend(transform(base), ...extensions)`。

| 变换                                          | 提升                    | 用途                                                |
| --------------------------------------------- | ----------------------- | --------------------------------------------------- |
| `withState(agent, lens)`：`S → T`             | `focus(ext, lens)`      | 把 agent 嵌进更大的状态里；中间件只看到自己那一部分 |
| `widen(agent, isNew, handlers)`：`A → A \| N` | `liftWiden(ext, isNew)` | 增加一种新动作，由外层中间件发出                    |

`Lens<T, S>` 必须满足三条 lens 定律：get-set、set-get、set-set。`@gaoxiang.ai/llm` 的插件状态也用 `Lens`：`pluginStateSlot(name, init)` 是指向 `state.plugins[name]` 的 lens，`plugin.select` 就是它的 `get`，状态 reducer 通过它的 `set` 写入。`liftWiden` 只接受 `env` / `update` 中间件：policy 中间件的输出里含有 `A`，没有通用的提升方式，类型上直接拒绝。

## Reducer（`/reduce`）

```ts
interface Reducer<In, Acc, Out = Acc> {
  init: Acc
  reduce: (acc: Acc, x: In) => Acc
  result?: (acc: Acc) => Out
}
```

`combine({ a: r1, b: r2 })` 一次遍历同时计算多个 reducer；`scan` 逐个输出中间结果。`@gaoxiang.ai/llm` 就是这样实现 `Run.summary` 和插件状态的。和 `update` 一样，`reduce` 必须同步且纯。
