# 编写插件

[English](../plugins.md) · **简体中文**

插件是一组有名字的钩子，每个钩子在一步中的固定位置执行（见 [核心概念](concepts.md#一步里发生了什么)）。

```ts
import { after, before, definePlugin } from '@gaoxiang.ai/llm'

export const myPlugin = definePlugin({
  name: 'my-plugin', // 必填，不能重名
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

## 钩子，按执行顺序

| 钩子      | 形状    | 执行时机                     | 典型用途                             |
| --------- | ------- | ---------------------------- | ------------------------------------ |
| `tools`   | 列表    | `createAgent` 时             | 注册工具                             |
| `system`  | 变换    | `createAgent` 时执行一次     | 修改 system prompt                   |
| `policy`  | 中间件  | 包住整一步                   | 压缩、预算、结束运行                 |
| `input`   | 变换    | 每个步边界                   | 自动继续、提醒                       |
| `context` | 变换    | 每次调用模型前               | 检索、窗口截取；不改历史             |
| `request` | 中间件  | 每次模型调用（流）           | 换模型、改 temperature、兜底         |
| `env`     | 中间件  | 一个回合的全部工具调用（流） | 批量审批；没有工具调用的回合不经过它 |
| `tool`    | 中间件  | 每次工具调用（流）           | 截断、审批、超时、重试、节流更新     |
| `update`  | 中间件  | 写入每一条 Turn              | 裁剪历史；必须是纯函数               |
| `state`   | reducer | `update` 之后                | 插件自己的数据；必须是纯函数         |
| `observe` | 观察者  | 每次运行的每个事件           | 日志、追踪、指标。只读               |

用 `myPlugin.select(state)` 读取插件状态；插件还没写入时返回 `init`。

## 两种形状

**变换**：`(value, context) => value`。按插件数组顺序依次执行，每个插件拿到上一个的结果。

**中间件**：`(input, next) => output`。

| 写法                | 效果       |
| ------------------- | ---------- |
| 返回 `next(input)`  | 什么都不改 |
| 改参数后调用 `next` | 改输入     |
| 改 `next` 的返回值  | 改输出     |
| 不调用 `next`       | 拦截       |
| 多次调用 `next`     | 重试       |

有副作用的钩子（`policy`、`request`、`env`、`tool`）都是**流**：`yield` 往这次运行追加一个事件，`return` 给出结果，`yield* next(...)` 把内层的事件原样传出去。

```ts
const retry = definePlugin({
  name: 'retry',
  async *tool(ctx, next) {
    try {
      return yield* next(ctx)
    } catch {
      return yield* next(ctx) // 两次尝试的事件都留在运行里
    }
  },
})
```

只改输入或只改输出时，用 `before(f)` / `after(g)` 简写。`after` 原样转发事件，`g` 只作用于结果；`mapDeltas(f)` 逐个改写事件，结果不变。事件只会到达运行的读者，要连写入状态的消息一起改，就同时用 `mapDeltas` 和 `after`。

## 顺序

- **同一个钩子**：`plugins` 数组里靠后的插件在**外层**，最先看到输入、最后看到输出。
- **不同钩子**：顺序由一步的结构固定，所以写不同钩子的插件怎么排都行。
- **预设**：`plugins` 可以嵌套数组。同一个插件对象登记多次不算冲突。

## 规则

1. `update` 和 `state.reduce` **同步且纯**。IO 放在 `policy`、`request`、`env` 或 `tool` 里。
2. 在 `policy`、`request`、`env`、`tool` 里用 **`return yield* next(...)`** 消费流，保证取消能传下去、内层事件和返回值都不会丢。
3. 工具用 **`toolError(call, reason)`** 报告失败，不要抛错。
4. 在 `policy` 里返回 `rewriteHistory(messages)` 替换历史，返回 `stop(state)` 以最后一条助手消息结束运行。
5. 插件之间不互相导入。它们共享的是每个插件都能读到的东西：`Turn`、消息，以及事件名和它的形状。

## 插件发出的事件

插件在任何流式钩子里 yield 一个事件，并用声明合并登记它的类型，命名为 `<插件名>:<事件>`：

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

读的人按 `e.type === 'compaction:start'` 判别，不需要导入这个插件；另一个插件要读，就自己声明同样的形状。事件出现在它被 yield 的位置：在 `next` 之前 yield，就排在 `next` 的事件之前。事件只陈述发生过的事。要根据别的插件做了什么来改变行为，请在 `state.reduce` 里读 `Turn`（压缩就是一个 `rewrite` turn，不管是谁做的），因为事件既不保存也不重放。

## 该用哪个钩子

| 我想……                            | 用                                          | 例子                                                                                   |
| --------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------- |
| 修改工具参数或结果                | `tool: before(...)` / `tool: after(...)`    | [`truncate-tool-results.ts`](../../apps/examples/src/plugins/truncate-tool-results.ts) |
| 审批、拦截、超时、重试工具        | `tool`                                      | 不调用 `next` 即拦截                                                                   |
| 换模型、改 temperature / thinking | `request: before(...)`                      | [`hooks.ts`](../../apps/examples/src/hooks.ts) 的 `lowTemperature`                     |
| 模型出错时换兜底模型              | `request`                                   | [`hooks.ts`](../../apps/examples/src/hooks.ts) 的 `fallbackTo`                         |
| 改写流式文字（只影响显示）        | `request: mapDeltas(...)`                   | 输出时遮盖密钥                                                                         |
| 给请求加检索结果、只发最近 N 条   | `context`                                   | [`hooks.ts`](../../apps/examples/src/hooks.ts) 的 `retrieval`                          |
| 任务没完成就自动继续、定时提醒    | `input`                                     | [`keep-going.ts`](../../apps/examples/src/plugins/keep-going.ts)                       |
| 写摘要并替换历史                  | `policy` + `rewriteHistory`                 | [`compaction.ts`](../../apps/examples/src/plugins/compaction.ts)                       |
| 预算、步数上限                    | `policy` + `stop`                           | [`budget.ts`](../../apps/examples/src/plugins/budget.ts)                               |
| 截断历史（不调用模型）            | `update`                                    | [`apps/demo`](../../apps/demo/src/main.ts) 的 `keepLast`                               |
| 保存自己的计数                    | `state: { init, reduce }`                   | [`keep-going.ts`](../../apps/examples/src/plugins/keep-going.ts)                       |
| 统计耗时、token、费用             | 不写插件：`r.summary`、`r.turns`、`usageOf` | [`metrics.ts`](../../apps/examples/src/metrics.ts)                                     |
| 记录日志、追踪、计数              | `observe`                                   | [`plugins/otel`](../../plugins/otel)、[`plugins/jsonl`](../../plugins/jsonl)           |
| 显示一个耗时步骤正在做什么        | 在 `policy`、`request` 或 `tool` 里 `yield` | [插件发出的事件](#插件发出的事件)                                                      |

[`apps/examples/src/plugins`](../../apps/examples/src/plugins) 里的插件可以直接复制过去改；[`plugins/`](../../plugins) 下的包可以直接安装：`otel`、`jsonl`、`throttle-updates`；每个示例的详细说明见 [示例 README](../../apps/examples/README.md)。

## 工具

```ts
import { tool, Type } from '@gaoxiang.ai/llm'

const calc = tool({
  name: 'calc',
  description: 'Evaluate an arithmetic expression.',
  parameters: Type.Object({ expr: Type.String() }),
  // expr 的类型 string 从 schema 推断
  run: ({ expr }, signal) => evaluate(expr),
})
```

`run` 之前会先按 schema 校验参数。同一回合的多个工具调用并行执行，它们的事件交错出现，结果保持调用顺序。`run` 写成异步生成器就能报告进度，见[工具的中间更新](sessions-and-runs.md#事件)。
