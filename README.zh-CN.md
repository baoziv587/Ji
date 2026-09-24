# JI（极）

[English](README.md) · **简体中文**

> **JI** 即「极」，取「极限」之意：内核只保留最少的部件，agent 反复执行同一步，直到得出结果。

> [!WARNING]
> JI 仍在开发中，API 可能还会变，包也还没有发布到 npm。

一个用来搭建 LLM agent 的小内核，以及开箱即用的 agent。

agent 的每一步都可以拆成三个函数：**决策**、**执行**、**记录**。其他功能都是套在这三个函数上的插件，比如压缩过长的历史、重试、限制花费、中途插话和用量统计。记录这一步没有副作用，所以对话状态是普通的 JSON，可以保存、加载、重新运行。

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
- **自带统计**：流式文字、每一步的记录、耗时、token、费用都能从运行结果直接读取，不需要额外插件。
- **说停就停**：退出任何 `for await`，HTTP 请求也会一起关闭。

## 快速开始

需要 **Node ≥ 24**（直接运行 `.ts`）和 **pnpm**。

```bash
pnpm install

# 离线：回放预先写好的回复，不需要 API key
pnpm demo

# 真实模型，API key 从环境变量读取
MODEL=anthropic/claude-sonnet-5 pnpm demo
```

任何支持的 `provider/model` 都可以用。更多可以直接运行的场景在 [apps/examples](apps/examples/README.md)：

```bash
cd apps/examples
pnpm compaction  # 上下文压缩
pnpm interject   # 运行中插话
pnpm hooks       # 自动继续、搜索、备用模型、花费上限
```

### 在终端里聊一聊

[`repl.ts`](apps/examples/src/repl.ts) 是用 JI 和 DeepSeek 写的聊天 REPL，大约 300 行。回答边生成边显示，能看到模型的思考过程、每次工具调用和结果，每条回答后显示 token、缓存命中和费用。

```bash
DEEPSEEK_API_KEY=sk-... pnpm repl
DEEPSEEK_API_KEY=sk-... DEEPSEEK_THINKING=high pnpm repl   # 一开始就打开思考
```

```
◆  You
│  Is 391 prime? Check with calc.
│
◌  Thinking
┊  391 = 17 × 23. Let me verify with calc.
│
▸  calc(expr: "391/17")
✓  calc  23
│
│  No, 391 is not prime: 391 = 17 × 23.
│
│  1.8s · in 916 · out 246 · cached 512 (56%) · $0.0001
```

对话中用 `/think high` 切换思考档位，Ctrl+C 停止当前回答，`/exit` 退出。实现说明见 [apps/examples › 极简 REPL](apps/examples/README.md#极简-repl--replts)。

## 包

| 包 | 是什么 | 什么时候用 |
| --- | --- | --- |
| [`@gaoxiang.ai/llm`](packages/llm) | LLM agent：`createAgent`、`createSession`、`definePlugin`、`tool` | 几乎总是 |
| [`@gaoxiang.ai/kernel`](packages/kernel) | 不绑定任何模型的内核：`unfold`、`extend` 等工具函数。零依赖 | 写非 LLM 的 agent，或者搭新的一层时 |
| [`apps/demo`](apps/demo) | 最小的端到端例子 | 入门 |
| [`apps/examples`](apps/examples) | 场景示例和可以直接复制的插件 | 写自己的插件时 |

## 文档

| 文档 | 内容 |
| --- | --- |
| [核心概念](docs/zh-CN/concepts.md) | 一步是怎么运行的、分层结构，以及设计遵守的几条规则 |
| [会话与运行](docs/zh-CN/sessions-and-runs.md) | 流式输出、插话、停止、保存与加载、统计 |
| [编写插件](docs/zh-CN/plugins.md) | 所有钩子、执行顺序，以及每种需求该用哪个钩子 |
| [内核 API](docs/zh-CN/kernel.md) | `unfold`、`extend` 和其他内核工具函数 |

## 开发

```bash
pnpm test         # vitest
pnpm typecheck    # 所有 workspace 跑 tsc
pnpm lint         # eslint（@antfu/eslint-config）
```

源码是 TypeScript，由 Node 直接运行，不需要构建。
