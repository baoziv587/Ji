# 会话与运行

[English](../sessions-and-runs.md) · **简体中文**

## 三个对象

```ts
// 无状态，可复用
const agent = createAgent({ model, system, tools, plugins, ...streamOptions })

// 一段对话
const chat = createSession(agent, { state, maxSteps })

// 一次运行
const r = chat.send('hi')
```

- **Agent**：模型 + 工具 + 插件。它没有状态，一个 agent 可以服务多个会话。工具或插件重名时抛出 `PluginConflictError`，并一次列出全部冲突。
- **Session**：持有 `state`（最后写入的状态）和 `pending`（尚未送达的消息）。唯一的方法是 `send`。
- **Run**：从第一步开始，到 agent 空闲、并且没有可送达的消息为止。

## 读取一次运行

所有成员共享同一次执行，可以同时读取多个。

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `r.text` | `AsyncIterable<string>` | 文字增量，从开始读取的那一刻算起 |
| `r.turns` | `AsyncIterable<TurnEvent>` | 每步一条：`turn`、`state`、`timing`、到这一步为止的 `summary`。**无论何时开始读，都从第 0 步开始** |
| `r` 本身 | `AsyncIterable<AgentEvent>` | 内核原始事件，包含所有模型增量（思考、工具参数） |
| `r.result` | `Promise<AssistantMessage>` | 最终回答 |
| `r.state` | `Promise<AgentState>` | 最终状态 |
| `r.summary` | `Promise<RunSummary>` | 模型回合数、token、费用、模型和工具耗时，以及每个工具的调用 / 出错次数和耗时 |
| `r.abort(reason?)` | | 取消运行。尚未送达的消息留在会话里 |

运行被取消或出错时，`result`、`state`、`summary` 会 reject。

```ts
const r = chat.send('重构 utils.ts')

const printing = (async () => {
  for await (const chunk of r.text) process.stdout.write(chunk)
})()

for await (const { t, turn, timing, summary } of r.turns) {
  statusBar.set(`step ${t} · ${timing.ms}ms · $${summary.usage.cost}`)
}
await printing
```

## 取消

- 提前退出任何 `for await`（`break` 或抛出异常）都会**取消整次运行**。
- `r.abort()` 是显式的取消。
- 取消信号会传到正在进行的模型请求和正在执行的工具。工具通过 `run(args, signal)` 拿到它。

## 在 agent 工作时插话

运行进行中调用 `send`，消息会并入**同一次运行**，返回同一个 `Run`。`when` 决定消息在哪个步边界插入：

| `when` | 名称 | 送达时机 |
| --- | --- | --- |
| `'idle'`（默认） | follow-up | agent 回答完之后 |
| `'step'` | steer | 下一个步边界，例如当前工具执行完之后 |
| `'now'` | interrupt | 立即取消当前这一步，已输出的部分被丢弃 |
| `(boundary) => boolean` | 自定义 | 条件为真的步边界 |

```ts
chat.send('改用 vitest', { when: 'step' })
chat.send('然后更新 changelog') // follow-up
chat.send('停，先列大纲', { when: 'now' })
```

**送达规则**：每个步边界上，按发送顺序检查等待中的消息，条件成立就插入。每插入一条，agent 就不再空闲，所以多条 follow-up 会逐条处理，效果和每次等上一次运行结束后再 `send` 相同。

## 保存与恢复

`chat.state` 和 `r.state` 是普通的 JSON：`{ messages, plugins }`。

```ts
const saved = JSON.stringify(chat.state)
const chat2 = createSession(agent, { state: JSON.parse(saved) })
// 也可以直接从消息列表开始：
createSession(agent, { state: messages })
```

保存和恢复之间可以更换插件列表。没有保存过状态的插件从它的 `init` 开始。

## 上限

`maxSteps`（默认 64）限制一次运行的步数。插入消息、结束运行各占一步。超出上限时运行失败。

## 统计，不需要插件

```ts
for await (const { timing, summary } of r.turns) {
  // 每一步的耗时，以及到目前为止的累计
}
const { turns, usage, modelMs, toolMs, tools } = await r.summary // 这次运行
usageOf(chat.state) // 整段对话
```

`timing` 包含 `ms`；模型回合还有 `modelMs`、`firstTokenMs`，以及按工具调用 id 记录的 `toolMs`。summary 里的 `toolMs` 是各次调用耗时之和，并行调用会重叠，所以可能大于实际经过的时间。`usageOf` 只计算仍在历史里的消息，压缩掉的消息不再计入。
