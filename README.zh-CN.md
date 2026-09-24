# JI（极）

[English](README.md) · **简体中文**

> **JI** 即「极」，取「极限」之意：内核只保留最少的部件，agent 反复执行同一步，直到得出结果。

一个小而代数化的 LLM agent 内核，以及基于 [pi-ai](https://github.com/badlogic/pi-mono/tree/main/packages/ai) 的开箱即用实现。

agent 的每一步都可以拆成三个函数：**决策**、**执行**、**记录**。其他功能都是套在这三个函数上的中间件，包括压缩、重试、预算、插话和统计。记录是纯函数，所以对话状态是普通的 JSON，可以保存、恢复、重放。

```ts
import { createAgent, createSession } from '@gaoxiang.ai/llm'

const agent = createAgent({
  model,
  system: 'Be concise.',
  tools: [readFile],
  plugins: [compaction({ model, maxTokens: 100_000 })],
})
const chat = createSession(agent)

const r = chat.send('总结一下 README')
for await (const chunk of r.text) process.stdout.write(chunk)

const { usage, tools } = await r.summary
// 普通 JSON：createSession(agent, { state }) 可以从这里继续
save(chat.state)
```

## 为什么用它

- **四个对象**：`Agent`、`Session`、`Run`、`Plugin`。会话只有一个方法 `send`。
- **插件挂在一步中的固定位置**：写不同钩子的插件，互相之间不依赖顺序。
- **运行中插话**：消息可以等 agent 空闲再插入，也可以等当前工具执行完插入，或者直接打断当前这一步。
- **自带可观测性**：文字增量、每步记录、耗时、token、费用都能从运行结果直接读取，不需要额外插件。
- **取消一路传到底**：退出任何 `for await`，底层的 HTTP 流都会被中止。

## 快速开始

需要 **Node ≥ 24**（直接运行 `.ts`）和 **pnpm**。

```bash
pnpm install

# 离线：用 pi-ai 的 faux provider 回放脚本
pnpm demo

# 真实模型，API key 从环境变量读取
MODEL=anthropic/claude-sonnet-5 pnpm demo
```

pi-ai 支持的任何 `provider/model` 都可以用。更多可以直接运行的场景在 [apps/examples](apps/examples/README.md)：

```bash
cd apps/examples
pnpm compaction  # 上下文压缩
pnpm interject   # steer / follow-up / interrupt
pnpm hooks       # 自动继续、检索、兜底模型、预算
```

## 包

| 包 | 是什么 | 什么时候用 |
| --- | --- | --- |
| [`@gaoxiang.ai/llm`](packages/llm) | LLM agent：`createAgent`、`createSession`、`definePlugin`、`tool` | 几乎总是 |
| [`@gaoxiang.ai/kernel`](packages/kernel) | 与模型无关的内核：`unfold`、`extend`、lens、reducer。零依赖 | 写非 LLM 的 agent，或者搭新的一层时 |
| [`apps/demo`](apps/demo) | 最小的端到端例子 | 入门 |
| [`apps/examples`](apps/examples) | 场景示例和可以直接复制的插件 | 写自己的插件时 |

## 文档

| 文档 | 内容 |
| --- | --- |
| [核心概念](docs/zh-CN/concepts.md) | 一步的模型、分层结构，以及设计依赖的几条不变量 |
| [会话与运行](docs/zh-CN/sessions-and-runs.md) | 流式输出、插话、取消、保存与恢复、统计 |
| [编写插件](docs/zh-CN/plugins.md) | 所有钩子、执行顺序，以及每种需求该用哪个钩子 |
| [内核 API](docs/zh-CN/kernel.md) | `unfold` / `extend`，以及改变类型参数的变换（`withState`、`widen` 等） |

## 开发

```bash
pnpm test         # vitest，包含基于性质的测试（fast-check）
pnpm typecheck    # 所有 workspace 跑 tsc
pnpm lint         # eslint（@antfu/eslint-config）
```

源码是 TypeScript，由 Node 直接运行，不需要构建。

## 状态

实验阶段。所有包都是 `0.0.0`、未发布，API 可能还会变。
