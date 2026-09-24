# 示例：用插件扩展 agent

三个可以直接运行的例子，以及它们用到的插件。插件代码在 [`src/plugins/`](src/plugins/)，可以直接复制到你的项目里改。

```bash
pnpm --filter @pi-rsi/examples compaction   # 上下文压缩
pnpm --filter @pi-rsi/examples truncate     # 剔除过大的工具结果
pnpm --filter @pi-rsi/examples metrics      # 记录耗时和费用
```

默认使用 pi-ai 的 faux provider 离线回放脚本。设置 `MODEL=anthropic/claude-sonnet-5`（或 pi-ai 支持的其他 `provider/model`）即可换成真实模型，API key 从环境变量读取。

## 1. 基本用法

```ts
import { createAgent, run, stream, tool, user } from '@pi-rsi/llm'

const agent = createAgent({
  model, // pi-ai 的 Model
  system: 'You are a helpful assistant.',
  tools: [readFile],
  plugins: [truncateToolResults(), metrics, compaction({ model, maxTokens: 100_000 })],
})

// 只要最终答案
const answer = await run(agent, [user('hi')])

// 或者逐个处理事件：模型输出的增量、每一步的工具结果、结束
for await (const e of stream(agent, [user('hi')])) {
  if (e.tag === 'delta') { /* e.delta：文字、思考、工具参数的增量 */ }
  if (e.tag === 'act') { /* e.obs：这一步的工具结果；e.state：当前状态，可以保存 */ }
  if (e.tag === 'done') { /* e.result：最终回答；e.state：最终状态 */ }
}
```

**保存与恢复。** `e.state` 是普通的 JSON 数据（消息历史 + 各插件的状态）。保存它，之后用 `stream(agent, savedState)` 继续；插件列表可以换，新插件从初始状态开始。

## 2. 写一个插件

```ts
import { definePlugin } from '@pi-rsi/llm'

export const myPlugin = definePlugin({
  name: 'my-plugin', // 必填，不能和其他插件重名
  tools: [/* ... */], // 注册工具
  system: prompt => `${prompt}\nBe concise.`, // 修改 system prompt
  tool: async (ctx, next) => next(ctx), // 包装每一次工具调用
  async* policy(state, next) { // 包装模型调用
    return yield* next(state)
  },
  update: (state, msg, results, next) => next(state, msg, results), // 包装状态更新
  state: { init: 0, reduce: (n, msg, results) => n + 1 }, // 插件自己的状态
})
```

所有钩子都是 `(input, next)`：

- 调用 `next` 并返回它的结果 = 什么都不改
- 改了参数再调用 `next` = 修改输入
- 改 `next` 的返回值 = 修改输出
- 不调用 `next` = 拦截；调用多次 = 重试

**顺序。** `plugins` 数组里后面的在外层：外层先收到输入、最后拿到输出。只有包装同一个钩子的插件之间，顺序才有影响。

**规则。**

- `update` 和 `state.reduce` 必须同步、纯（不读时钟、不发请求），否则保存后恢复的结果会不同。需要 IO 的事放在 `tool` 或 `policy` 里，把结果写进消息，再由 `update` / `reduce` 记录。
- `policy` 里消费 `next` 用 `return yield* next(...)`，这样取消能传到底层请求，返回值也不会丢。
- 工具出错、拦截、拒绝时返回 `toolError(call, reason)`，不要抛错。即使抛了，也会被转成错误结果交给模型。

## 3. 该写在哪里

| 我想…… | 写在 | 例子 |
| --- | --- | --- |
| 修改工具参数、结果 | `tool` | 截短过大的结果 |
| 审批、拦截、超时、重试 | `tool` | 不调用 `next` 即拦截 |
| 测量工具耗时 | `tool` 测量，写进 `result.details` | `metrics` |
| 限制模型看到的上下文（不改历史） | `policy`：`next({ ...state, messages: view })` | |
| 替换历史（压缩） | `policy` 返回 `rewriteHistory(messages)` | `compaction` |
| 累计 token、费用、计数 | `state.reduce` | `metrics` |
| 截断历史（不需要调用模型） | `update` | demo 里的 `keepLast` |
| 日志、追踪、模型耗时 | 不写插件，在消费事件流时处理 | `withStepTimings` |

## 4. 例子

### 上下文压缩 · [`compaction.ts`](src/plugins/compaction.ts)

```ts
compaction({ model: cheapModel, maxTokens: 100_000, keepRecent: 6 })
```

每次调用模型前估算上下文大小；超过 `maxTokens` 时，用 `cheapModel` 把较早的消息写成摘要，把历史替换成「摘要 + 最近 `keepRecent` 条消息」，然后照常调用模型。

要点：

- **写摘要在 `policy` 里做，替换历史用 `rewriteHistory`。** 写摘要要调用模型，是 IO；`update` 必须纯，不能做。`rewriteHistory` 把新历史作为这一步的结果交给 agent，由 agent 在状态里替换，事件流里会出现一个 `act` 事件（`isHistoryRewrite(e.action)` 为真）。
- **切点不会拆开工具调用和它的结果**（`cutIndex`），否则 provider 会拒绝请求。
- **刚压缩过、可压缩的消息太少时不再压缩**，避免反复压缩。
- 被替换的消息不再留在状态里。需要完整记录时，在消费事件流时另存。
- 插件的 `update`、`state.reduce` 不会收到 `rewriteHistory` 这一步，只处理模型回合。

### 剔除过大的工具结果 · [`truncate-tool-results.ts`](src/plugins/truncate-tool-results.ts)

```ts
truncateToolResults({ maxChars: 8_000 })
```

工具结果的文本超过 `maxChars` 时，保留开头约 70% 和结尾约 20%，中间换成 `[... N characters omitted ...]`。原始长度写在 `result.details.truncated.originalChars`：`details` 只保存在历史里，不会发给模型，可以给 UI 用。

它包装的是每一次工具调用（`tool` 钩子），所以对所有工具生效，工具本身不用改。

### 记录耗时和费用 · [`metrics.ts`](src/plugins/metrics.ts)

分三处记录，各自放在最合适的位置：

| 记录什么 | 在哪里 | 为什么 |
| --- | --- | --- |
| 每次工具调用耗时 | `metrics` 插件的 `tool` 钩子，写进 `result.details.durationMs` | 读时钟是 IO，要在执行工具时做 |
| 累计 token、费用、工具调用数和耗时 | `metrics` 插件的 `state.reduce` | 纯函数累加，随状态保存 |
| 每一步首 token 延迟、模型耗时、工具耗时 | `withStepTimings(stream(...), report)` | 只是观察，不改变行为，所以不写成插件 |

```ts
const agent = createAgent({ model, tools, plugins: [metrics] })
const events = withStepTimings(stream(agent, input), t => console.log(t))

for await (const e of events) {
  if (e.tag === 'done') {
    console.log(withFinalTurn(e.state, e.result)) // 加上最后一个回合的用量
  }
}
```

最后一个回合（模型直接回答、不再调用工具）不经过 `update`，所以 `metrics.select(state)` 里没有它；`withFinalTurn` 把 `done` 事件里的用量补上。

faux provider 的费用恒为 0，换成真实模型后才有费用。

## 5. 组合

```ts
plugins: [truncateToolResults(), metrics, compaction({ model, maxTokens: 100_000 })]
```

三个插件包装的钩子不同（`tool` 截短、`tool` 计时、`policy` 压缩），只有前两个都包装 `tool`：`metrics` 在外层，测到的耗时包含截短的时间。反过来写也可以，结果只差这一点。
