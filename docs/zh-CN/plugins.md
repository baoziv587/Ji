# 编写插件

[English](../plugins.md) · **简体中文**

插件是一组有名字的钩子，每个钩子在一步中的固定位置执行（见 [核心概念](concepts.md#一步里发生了什么)）。

```ts
import { after, before, definePlugin } from '@ji/llm'

export const myPlugin = definePlugin({
  name: 'my-plugin', // 必填，不能重名
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

## 钩子，按执行顺序

| 钩子 | 形状 | 执行时机 | 典型用途 |
| --- | --- | --- | --- |
| `tools` | 列表 | `createAgent` 时 | 注册工具 |
| `system` | 变换 | `createAgent` 时执行一次 | 修改 system prompt |
| `policy` | 中间件 | 包住整一步 | 压缩、预算、结束运行 |
| `input` | 变换 | 每个步边界 | 自动继续、提醒 |
| `context` | 变换 | 每次调用模型前 | 检索、窗口截取；不改历史 |
| `request` | 中间件 | 每次模型调用（流） | 换模型、改 temperature、兜底 |
| `env` | 中间件 | 一个回合的全部工具调用 | 批量审批；没有工具调用的回合不经过它 |
| `tool` | 中间件 | 每次工具调用 | 截断、审批、超时、重试 |
| `update` | 中间件 | 写入每一条 Turn | 裁剪历史；必须是纯函数 |
| `state` | reducer | `update` 之后 | 插件自己的数据；必须是纯函数 |

用 `myPlugin.select(state)` 读取插件状态；插件还没写入时返回 `init`。

## 两种形状

**变换**：`(value, context) => value`。按插件数组顺序依次执行，每个插件拿到上一个的结果。

**中间件**：`(input, next) => output`。

| 写法 | 效果 |
| --- | --- |
| 返回 `next(input)` | 什么都不改 |
| 改参数后调用 `next` | 改输入 |
| 改 `next` 的返回值 | 改输出 |
| 不调用 `next` | 拦截 |
| 多次调用 `next` | 重试 |

只改输入或只改输出时，用 `before(f)` / `after(g)` 简写。在流式钩子（`request`）上，`after` 原样转发增量，`g` 只作用于最终消息。

## 顺序

- **同一个钩子**：`plugins` 数组里靠后的插件在**外层**，最先看到输入、最后看到输出。
- **不同钩子**：顺序由一步的结构固定，所以写不同钩子的插件怎么排都行。
- **预设**：`plugins` 可以嵌套数组。同一个插件对象登记多次不算冲突。

## 规则

1. `update` 和 `state.reduce` **同步且纯**。IO 放在 `policy`、`request`、`env` 或 `tool` 里。
2. 在 `policy` 和 `request` 里用 **`return yield* next(...)`** 消费流，保证取消能传下去、返回值不会丢。
3. 工具用 **`toolError(call, reason)`** 报告失败，不要抛错。
4. 在 `policy` 里返回 `rewriteHistory(messages)` 替换历史，返回 `stop(state)` 以最后一条助手消息结束运行。

## 该用哪个钩子

| 我想…… | 用 | 例子 |
| --- | --- | --- |
| 修改工具参数或结果 | `tool: before(...)` / `tool: after(...)` | [`truncate-tool-results.ts`](../../apps/examples/src/plugins/truncate-tool-results.ts) |
| 审批、拦截、超时、重试工具 | `tool` | 不调用 `next` 即拦截 |
| 换模型、改 temperature / thinking | `request: before(...)` | [`hooks.ts`](../../apps/examples/src/hooks.ts) 的 `lowTemperature` |
| 模型出错时换兜底模型 | `request` | [`hooks.ts`](../../apps/examples/src/hooks.ts) 的 `fallbackTo` |
| 给请求加检索结果、只发最近 N 条 | `context` | [`hooks.ts`](../../apps/examples/src/hooks.ts) 的 `retrieval` |
| 任务没完成就自动继续、定时提醒 | `input` | [`keep-going.ts`](../../apps/examples/src/plugins/keep-going.ts) |
| 写摘要并替换历史 | `policy` + `rewriteHistory` | [`compaction.ts`](../../apps/examples/src/plugins/compaction.ts) |
| 预算、步数上限 | `policy` + `stop` | [`budget.ts`](../../apps/examples/src/plugins/budget.ts) |
| 截断历史（不调用模型） | `update` | [`apps/demo`](../../apps/demo/src/main.ts) 的 `keepLast` |
| 保存自己的计数 | `state: { init, reduce }` | [`keep-going.ts`](../../apps/examples/src/plugins/keep-going.ts) |
| 统计耗时、token、费用 | 不写插件：`r.summary`、`r.turns`、`usageOf` | [`metrics.ts`](../../apps/examples/src/metrics.ts) |

[`apps/examples/src/plugins`](../../apps/examples/src/plugins) 里的插件可以直接复制过去改；每个示例的详细说明见 [示例 README](../../apps/examples/README.md)。

## 工具

```ts
import { tool } from '@ji/llm'
import { Type } from '@mariozechner/pi-ai'

const calc = tool({
  name: 'calc',
  description: 'Evaluate an arithmetic expression.',
  parameters: Type.Object({ expr: Type.String() }),
  run: ({ expr }, signal) => evaluate(expr), // expr 的类型 string 从 schema 推断
})
```

`run` 之前会先按 schema 校验参数。同一回合的多个工具调用并行执行。
