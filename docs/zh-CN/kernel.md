# 内核 API

[English](../kernel.md) · **简体中文** · [文档导航](README.md)

`@ji.dev/kernel` 零依赖，与 LLM 无关。写非 LLM 的 agent、或者搭新的一层时直接使用；其他情况下，[`@ji.dev/llm`](sessions-and-runs.md) 已经把它包装好了。

<br>

## 先跑一个最小循环

下面的 agent 从 `0` 数到 `3`。`policy` 决定下一步，`env` 执行动作，`update` 保存结果。`run` 消费整个循环并返回 `3`：

```ts
import type { Agent } from '@ji.dev/kernel'
import { act, done, run } from '@ji.dev/kernel'

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

<br>

## 核心

| 入口                      | 内容                                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `@ji.dev/kernel`          | `Agent`、`Extension`、`unfold`、`run`、`extend`、`mapState`、`mapYield`、`merge`、`act`、`done`、`MaxStepsError` |
| `@ji.dev/kernel/advanced` | 改变类型参数的变换：`withState` / `focus`、`widen` / `liftWiden`                                                 |
| `@ji.dev/kernel/reduce`   | 可组合的 reducer：`sum`、`count`、`combine`、`mapInput`、`filterInput`、`mapResult`、`reduce`、`scan`            |

```ts
interface Agent<S, A, O, R, D = never> {
  policy: (s: S) => Stream<D, Step<A, R>> // Stream = AsyncGenerator<D, Step>
  env: (a: A) => Stream<D, O>
  update: (s: S, a: A, o: O) => S // 同步、纯
}
```

policy 先产出任意多个增量 `D`，然后返回 `act(action)` 继续，或者返回 `done(result)` 结束。env 执行时产出同一类型的增量，最后返回观测。有副作用的都是流，`update` 是普通函数。没什么可报告的 env 写成 `async function* (a) { return o }`。

| 函数                              | 作用                                                                                                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unfold(agent, s, maxSteps = 32)` | 惰性事件流：`delta`（先 policy 后 env）、`act`（带 `obs` 和新的 `state`）、`done`。对它调用 `return()` 会一路取消到底，包括 env。超过 `maxSteps` 抛出 `MaxStepsError` |
| `run(agent, s, maxSteps?)`        | 把 `unfold` 折叠成最终结果                                                                                                                                            |
| `extend(agent, ...exts)`          | 套上中间件。**先出现的在内层，后出现的在外层**                                                                                                                        |
| `mapState(agent, f)`              | 对状态做后处理的 `update` 中间件简写                                                                                                                                  |
| `mapYield(stream, f)`             | 带 map 的 `yield*`：变换每个增量，保留返回值，并传递取消                                                                                                              |
| `merge(streams)`                  | 同时运行多个流：增量按到达顺序产出，结果按来源顺序返回。取消它会关闭所有已启动的来源                                                                                  |

一个 `Extension` 最多包含三个中间件，形状和 [LLM 插件](plugins.md#钩子签名) 一样，都是 `(input, next)`。

```ts
const logged = extend(agent, {
  async *env(a, next) {
    console.log('act', a)
    return yield* next(a)
  },
})
```

<br>

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

`Lens<T, S>` 必须满足三条 lens 定律：get-set、set-get、set-set。`@ji.dev/llm` 的插件状态也用 `Lens`：`pluginStateSlot(name, init)` 是指向 `state.plugins[name]` 的 lens，`plugin.select` 就是它的 `get`，状态 reducer 通过它的 `set` 写入。

`liftWiden` 只接受 `env` / `update` 中间件：policy 中间件的输出里含有 `A`，没有通用的提升方式，类型上直接拒绝。

<br>

## Reducer（`/reduce`）

```ts
interface Reducer<In, Acc, Out = Acc> {
  init: Acc
  reduce: (acc: Acc, x: In) => Acc
  result?: (acc: Acc) => Out
}
```

`combine({ a: r1, b: r2 })` 一次遍历同时计算多个 reducer；`scan` 逐个输出中间结果。`@ji.dev/llm` 就是这样实现 `Run.summary` 和插件状态的。和 `update` 一样，`reduce` 必须同步且纯。

<br>

## 继续阅读

[核心概念](concepts.md) · [编写 LLM 插件](plugins.md) · [文档导航](README.md)
