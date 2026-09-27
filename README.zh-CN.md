# JI（极）

[English](README.md) · **简体中文**

**小巧、可扩展的 TypeScript LLM agent 运行时。**

JI 负责模型调用、工具执行和对话状态。用插件扩展行为，用同一个 Run 读取流式回答和用量统计。

> 开发中，API 可能变化，包尚未发布到 npm。

## Highlights

- **一致的钩子 API。** `before` 改输入，`after` 改结果，`intercept` 提前返回。同一套 helper 包装 `decide`、`request`、`toolCalls`、`toolCall` 四个钩子。
- **上下文压缩也是插件。** 用 `ctx.complete` 总结早期消息，再用 `rewriteHistory` 更新历史，复用已有的请求插件、取消和用量统计。[查看实现 →](apps/examples/src/plugins/compaction.ts)
- **运行中随时调整。** 消息可以排队、在下一步送达，或立即打断；对话与插件状态一起保存为 JSON。
- **自带运行信息。** 流式文字、每一步的记录、token、费用和耗时，无需额外插件。

**钩子决定在哪里介入，helper 决定怎么介入。** 三个独立插件，分别改请求、改工具结果、拦截调用：

```ts
import { after, before, definePlugin, intercept, toolError } from '@gaoxiang.ai/llm'

const lowTemperature = definePlugin({
  name: 'low-temperature',
  request: before(req => ({ ...req, options: { ...req.options, temperature: 0 } })),
})

const trimOutput = definePlugin({
  name: 'trim-output',
  toolCall: after(result => ({
    ...result,
    content: result.content.map(part => (part.type === 'text' ? { ...part, text: part.text.slice(0, 2_000) } : part)),
  })),
})

const blockShell = definePlugin({
  name: 'block-shell',
  toolCall: intercept(call => (call.name === 'shell' ? toolError(call, 'Shell access is disabled.') : undefined)),
})

const toolPlugins = [trimOutput, blockShell]
```

插件可以独立复用，也可以组成数组预设。相同钩子按插件列表从外到内包装；`intercept` 返回 `undefined` 放行。需要重试、串行执行或发事件时，直接写 `(input, next, ctx)` 中间件，用 `yield* next(input)` 继续。

### 用中间件压缩上下文

核心流程如下；估算 token、保留工具调用配对和整理文本的辅助函数见 [完整实现](apps/examples/src/plugins/compaction.ts)。

```ts
import { definePlugin, rewriteHistory, textOf, user } from '@gaoxiang.ai/llm'

const compactHistory = definePlugin({
  name: 'compaction',
  async *decide(state, next, { complete }) {
    const { messages } = state
    const cut = cutIndex(messages, 6)
    if (estimateTokens(messages) <= 100_000 || cut < 2) return yield* next(state)

    const summary = yield* complete({
      systemPrompt: 'Summarize facts, decisions, open tasks and important tool results.',
      messages: [user(transcript(messages.slice(0, cut)))],
    })
    return rewriteHistory([user(textOf(summary)), ...messages.slice(cut)])
  },
})
```

加进 `plugins` 即可。摘要调用复用 request 插件、取消和统计，新的历史通过 `record` 保存。

### 工具边执行，边报告进度

工具中的 `yield` 自动成为 `tool_update`，`return` 才是交给模型的最终结果：

```ts
import { createAgent, createSession, tool, Type } from '@gaoxiang.ai/llm'

const checkUrls = tool({
  name: 'check_urls',
  description: 'Check HTTP status codes for a list of URLs.',
  parameters: Type.Object({ urls: Type.Array(Type.String()) }),
  async *run({ urls }, signal) {
    const results = []
    for (const [i, url] of urls.entries()) {
      const response = await fetch(url, { method: 'HEAD', signal })
      results.push({ url, status: response.status })
      yield { done: i + 1, total: urls.length, url, status: response.status }
    }
    return JSON.stringify(results)
  },
})

const checking = createSession(createAgent({ model, tools: [checkUrls] }))
for await (const event of checking.send('Check https://example.com')) {
  if (event.type === 'tool_update') console.log(event.call.name, event.data)
}
```

同一条事件流还包含文字、工具开始与结束；需要降低进度推送频率时，组合 [throttleUpdates](plugins/throttle-updates/src/index.ts) 插件。

更多能力，仍用同一套钩子：

| 能力       | 示例                                                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| 管理上下文 | [自动压缩](apps/examples/src/plugins/compaction.ts)、[截断工具结果](apps/examples/src/plugins/truncate-tool-results.ts) |
| 推进任务   | [自动继续](apps/examples/src/plugins/keep-going.ts)、[检索与备用模型](apps/examples/src/hooks.ts)                       |
| 控制工具   | [串行执行](apps/examples/src/plugins/sequential-tools.ts)、[进度节流](plugins/throttle-updates/src/index.ts)            |
| 导出事件   | [OpenTelemetry](plugins/otel/src/index.ts)、[JSONL](plugins/jsonl/src/index.ts)                                         |

## 快速开始

需要 **Node ≥ 24** 和 **pnpm**，在仓库根目录运行：

```bash
pnpm install
pnpm demo
```

demo 离线演示计算工具，无需 API key。连接真实模型时，设置服务商的 API key，再运行 `MODEL=provider/model pnpm demo`，将 `provider/model` 换成支持的模型。

选好 `model` 和插件后，应用中的调用如下：

```ts
import { createAgent, createSession } from '@gaoxiang.ai/llm'

const agent = createAgent({ model, plugins: [lowTemperature, toolPlugins] })
const chat = createSession(agent)
const run = chat.send('用一句话解释什么是中间件')

for await (const chunk of run.text) process.stdout.write(chunk)
console.log(await run.summary)
```

更多离线示例见 [apps/examples](apps/examples/README.md)。

## 文档

[会话与运行](docs/zh-CN/sessions-and-runs.md) · [编写插件](docs/zh-CN/plugins.md) · [核心概念](docs/zh-CN/concepts.md) · [内核 API](docs/zh-CN/kernel.md) · [可运行示例](apps/examples/README.md)

构建 LLM agent 用 [`@gaoxiang.ai/llm`](packages/llm)；需要自定义「决策 → 执行 → 记录」循环时，用零依赖的 [`@gaoxiang.ai/kernel`](packages/kernel)。

## 开发

```bash
pnpm test
pnpm typecheck
pnpm lint
```
