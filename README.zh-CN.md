# JI（极）

_极，取「极简」与「极限」之意：内核做到极简，能力靠插件推向极限。_

> 开发中，API 可能变化，包尚未发布到 npm。

<br>

[English](README.md) · **简体中文**

**小巧、可扩展的 TypeScript LLM agent 运行时。**

```ts
import { createAgent, createSession } from '@ji.dev/llm'

const agent = createAgent({ model, plugins: [lowTemperature, toolPlugins] })
const chat = createSession(agent)
const run = chat.send('用一句话解释什么是中间件')

for await (const chunk of run.text) process.stdout.write(chunk)

console.log(await run.summary)
```

<br>

## Highlights

**一套一致的 hook API，从几行变换到完整中间件；独立编写的插件，可以自由组合。**

长时间工具调用也能随时报告进度：工具里 `yield`，运行中就收到 `tool_update`。

<br>

### 一套钩子，三种介入方式

**钩子决定在哪里介入，helper 决定怎么介入。**

`before` 改输入 · `after` 改结果 · `intercept` 提前返回。它们通用于 `decide`、`request`、`toolCalls`、`toolCall`。

```ts
import { after, before, definePlugin, intercept, toolError } from '@ji.dev/llm'

const lowTemperature = definePlugin({
  name: 'low-temperature',
  request: before(req => ({ ...req, options: { ...req.options, temperature: 0 } })),
})

const trimOutput = definePlugin({
  name: 'trim-output',
  toolCall: after(result => ({
    ...result,
    content: result.content.map(part =>
      part.type === 'text' ? { ...part, text: part.text.slice(0, 2_000) } : part,
    ),
  })),
})

const blockShell = definePlugin({
  name: 'block-shell',
  toolCall: intercept(call =>
    call.name === 'shell' ? toolError(call, 'Shell access is disabled.') : undefined,
  ),
})
```

`intercept` 返回 `undefined` 放行；需要重试、串行执行或发事件时，展开为 `(input, next, ctx)`，用 `yield* next(input)` 继续。

<br>

### 独立编写，按需组合

每个插件只负责一件事。组合成数组预设后，还可以继续嵌套复用：

```ts
const toolPlugins = [trimOutput, blockShell]
const plugins = [lowTemperature, toolPlugins]
```

传给 `createAgent({ model, plugins })` 即可。同一钩子按列表从外到内包装：输入依次进入，结果反向返回。[组合顺序 →](docs/zh-CN/plugins.md#顺序)

<br>

### 用中间件压缩上下文

**复杂能力，也沿用同一套中间件。** `decide` 中调用 `complete` 生成摘要，再用 `rewriteHistory` 替换历史。

```ts
import { definePlugin, rewriteHistory, textOf, user } from '@ji.dev/llm'

const compactHistory = definePlugin({
  name: 'compaction',
  async *decide(state, next, { complete }) {
    const { messages } = state
    const cut = cutIndex(messages, 6)

    if (estimateTokens(messages) <= 100_000 || cut < 2) return yield* next(state)

    const summary = yield* complete({
      systemPrompt:
        'Summarize facts, decisions, open tasks and important tool results.',
      messages: [user(transcript(messages.slice(0, cut)))],
    })

    return rewriteHistory([user(textOf(summary)), ...messages.slice(cut)])
  },
})
```

压缩插件调用模型时，已有的 `request` 插件仍会生效，温度设置、备用模型等能力无需重写；新的历史通过 `record` 保存。

[完整实现 →](apps/examples/src/plugins/compaction.ts) 包含上例的 token 估算、工具调用配对和文本整理辅助函数。

<br>

### 长时间工具调用，随时更新进度

**不用等工具结束，用户就能看到进展。**

把工具写成异步生成器：`yield` 报告进度，`return` 交付最终结果，无需另写回调或事件通道。下面以批量检查 URL 为例：

```ts
import { createAgent, createSession, tool, Type } from '@ji.dev/llm'

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
```

在运行的事件流中读取进度：

```ts
const checking = createSession(
  createAgent({ model, tools: [checkUrls], plugins: toolPlugins }),
)

for await (const event of checking.send('Check https://example.com')) {
  if (event.type === 'tool_update') console.log(event.call.name, event.data)
}
```

同一工具可以组合结果截断、调用拦截和 [进度节流](plugins/throttle-updates/src/index.ts)。`toolCall` 中间件包装整条执行流，`observe` 可以统一记录事件。

<br>

### 更多能力，按需组合

| 能力       | 示例                                                                                                                                                              |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 管理上下文 | [自动压缩](apps/examples/src/plugins/compaction.ts)、[截断工具结果](apps/examples/src/plugins/truncate-tool-results.ts)                                           |
| 推进任务   | [自动继续](apps/examples/src/plugins/keep-going.ts)、[检索与备用模型](apps/examples/src/hooks.ts)                                                                 |
| 控制工具   | [串行执行](apps/examples/src/plugins/sequential-tools.ts)、[进度节流](plugins/throttle-updates/src/index.ts)、[提问与调用前审批](plugins/choices/README.zh-CN.md) |
| 导出事件   | [OpenTelemetry](plugins/otel/src/index.ts)、[JSONL](plugins/jsonl/src/index.ts)                                                                                   |

<br>

## 快速开始

需要 **Node ≥ 24** 和 **pnpm**，在仓库根目录运行：

```bash
pnpm install
pnpm demo
```

demo 离线演示计算工具，无需 API key。

连接真实模型时，设置服务商的 API key，再运行 `MODEL=provider/model pnpm demo`，将 `provider/model` 换成支持的模型。

更多离线示例见 [apps/examples](apps/examples/README.md)。

<br>

## 文档

- [会话与运行](docs/zh-CN/sessions-and-runs.md) — 流式输出、插话、停止与恢复
- [编写插件](docs/zh-CN/plugins.md) — 钩子、组合顺序与中间件
- [核心概念](docs/zh-CN/concepts.md) · [内核 API](docs/zh-CN/kernel.md) — 理解底层循环
- [可运行示例](apps/examples/README.md) — 从具体场景开始

构建 LLM agent 用 [`@ji.dev/llm`](packages/llm)；需要自定义「决策 → 执行 → 记录」循环时，用零依赖的 [`@ji.dev/kernel`](packages/kernel)。
测试 agent 或插件、不想连真实模型时，用 [`@ji.dev/testing`](packages/testing) 提供的按脚本回复的模型。

<br>

## 开发

```bash
pnpm test
pnpm typecheck
pnpm lint
```
