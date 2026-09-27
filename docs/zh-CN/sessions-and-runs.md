# 会话与运行

[English](../sessions-and-runs.md) · **简体中文**

## 三个对象

```ts
// 无状态，可复用
const agent = createAgent({ model: 'deepseek/deepseek-v4-flash', thinking, system, tools, plugins, ...streamOptions })

// 一段对话
const chat = createSession(agent, { state, maxSteps })

// 一次运行
const r = chat.send('hi')
```

- **Agent**：模型 + 工具 + 插件。它没有状态，一个 agent 可以服务多个会话。配置错误在这里就暴露，而不是等到第一次请求：模型不存在抛出 `UnknownModelError`（带最接近的候选），思考档位不受支持抛出 `UnsupportedThinkingError`（列出支持的档位），工具或插件重名抛出 `PluginConflictError`，并一次列出全部冲突。
- **Session**：持有 `state`（最后写入的状态）和 `pending`（尚未送达的消息）。方法是 `send` 和 `use`。
- **Run**：从第一步开始，到 agent 空闲、并且没有可送达的消息为止。

## 模型与思考档位

`model` 写成 pi-ai 目录里的 `'provider/id'`，其他情况（自定义 `baseUrl`、faux provider）传 pi-ai 的 `Model` 对象。模型支持什么，agent 自己知道，不需要再去问 pi-ai：

```ts
const agent = createAgent({ model: 'deepseek/deepseek-v4-flash', thinking: 'high' })
agent.model.thinkingLevels // ['off', 'high', 'xhigh']
agent.thinking // 'high'
agent.model.hasEnvKey // 此刻是否设置了 DEEPSEEK_API_KEY
```

`thinking` 取 `'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'`，默认 `'off'`；对总是思考的模型，默认取它最轻的档位。模型不支持的档位在 `createAgent` 时就报错，不会被悄悄换掉。创建 agent 之前（比如做模型选择界面）用 `findModel(spec)`、`listModels(provider?)` 拿到同样的信息。

- **对话中途换档**：`chat.use(agent.with({ thinking: 'xhigh' }))`。`with` 返回一个新 agent，原来的不变；`use` 在下一个步边界生效，状态、排队的消息和正在进行的运行都保留。
- **按请求改**：写一个 `request: before(req => ({ ...req, thinking: 'xhigh' }))` 插件。插件也可能换了模型，所以这里的档位会映射到这次请求的模型支持的最近一档，实际发出的档位在 `model_start` 里报告。
- **API key**：库不替你检查，因为 key 也可能来自 `apiKey` 或 request 插件。在用户准备发送时检查 `agent.model.hasEnvKey`，而不是一开始就拦住。

## 读取一次运行

所有成员共享同一次执行，可以同时读取多个。

| 成员               | 类型                        | 说明                                                                                               |
| ------------------ | --------------------------- | -------------------------------------------------------------------------------------------------- |
| `r.text`           | `AsyncIterable<string>`     | 文字增量，从开始读取的那一刻算起                                                                   |
| `r.turns`          | `AsyncIterable<TurnEvent>`  | 每步一条：`turn`、`state`、`timing`、到这一步为止的 `summary`。**无论何时开始读，都从第 0 步开始** |
| `r` 本身           | `AsyncIterable<RunEvent>`   | 这次运行的全部事件，按顺序，每个事件一个 `type`（[见下文](#事件)）                                 |
| `r.result`         | `Promise<AssistantMessage>` | 最终回答                                                                                           |
| `r.state`          | `Promise<AgentState>`       | 最终状态                                                                                           |
| `r.summary`        | `Promise<RunSummary>`       | 模型回合数、token、费用、模型和工具耗时，以及每个工具的调用 / 出错次数和耗时                       |
| `r.abort(reason?)` |                             | 取消运行。尚未送达的消息留在会话里                                                                 |

运行被取消或出错时，`result`、`state`、`summary` 以 `RunError` reject。它带有 `kind`（`'aborted'`、`'max_steps'`、`'provider'`、`'internal'`）、出错的步 `t`、可用来恢复的最后写入的 `state`，原始错误在 `cause` 里。

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

## 事件

读 `r` 得到一条扁平的事件流，按 `e.type` 判别即可。每个事件还带有步号 `t`。

| 事件                      | 什么时候                                                              |
| ------------------------- | --------------------------------------------------------------------- |
| `step_start` / `step_end` | 一步开始 / 写入状态。`step_end` 与 `r.turns` 的每一项相同             |
| `step_cancelled`          | 一步在写入前被中断或取消。`open` 列出仍在运行的工具调用               |
| `model_start`             | 请求发出：实际使用的模型和思考档位                                    |
| `thinking` / `text`       | 模型的输出，字段是 `delta`                                            |
| `tool_call`               | 模型写完了一次调用的参数。**工具还没开始执行**                        |
| `model_end`               | 完整的消息，带用量和 `ms`                                             |
| `tool_start` / `tool_end` | 工具真正开始 / 得到结果，带 `ms`。并行的调用按完成顺序结束            |
| `tool_update`             | 工具 yield 的一个值（见下文）                                         |
| `run_end`                 | 运行结束：`outcome` 为 `'done'` 带结果，或为 `'failed'` 带 `RunError` |
| `<插件名>:<事件>`         | 插件 yield 的事件（[编写插件](plugins.md#插件发出的事件)）            |

每个 `tool_start` 都会被它的 `tool_end` 或这一步的 `step_cancelled` 关闭，界面上不会留下一直转的 spinner。

```ts
for await (const e of r) {
  switch (e.type) {
    case 'text':
      process.stdout.write(e.delta)
      break
    case 'tool_start':
      ui.spin(e.call.id, e.call.name)
      break
    case 'tool_update':
      ui.progress(e.call.id, e.data)
      break
    case 'tool_end':
      ui.done(e.call.id, e.result)
      break
  }
}
```

**工具的中间更新**：`run` 写成异步生成器的工具可以边做边报告。每个 `yield` 成为一个 `tool_update`（任意值：数字、字符串、对象），`return` 的值是结果。取消时它的 `finally` 照常执行。

```ts
const runTests = tool({
  name: 'run_tests',
  description: 'Run the test files matching a glob.',
  parameters: Type.Object({ pattern: Type.String() }),
  async *run({ pattern }, signal) {
    const files = await glob(pattern)
    for (const [i, file] of files.entries()) {
      yield { message: file, done: i, total: files.length }
      await runFile(file, signal)
    }
    return `${files.length} files passed`
  },
})
```

**日志与追踪**：`for await` 循环抛错或提前退出会取消整次运行，而且它只能看到一次运行。日志、追踪、指标请用插件的只读钩子 `observe`：它从第一个事件起收到这个 agent 每次运行的全部事件，抛出的异常只会作为警告报告，不影响运行。现成的插件在 [`plugins/`](../../plugins)：`@gaoxiang.ai/plugin-otel`、`@gaoxiang.ai/plugin-jsonl`。

## 取消

- 提前退出任何 `for await`（`break` 或抛出异常）都会**取消整次运行**。
- `r.abort()` 是显式的取消。
- 取消信号会传到正在进行的模型请求和正在执行的工具。工具通过 `run(args, signal)` 拿到它。

## 在 agent 工作时插话

运行进行中调用 `send`，消息会并入**同一次运行**，返回同一个 `Run`。`when` 决定消息在哪个步边界插入：

| `when`                  | 名称      | 送达时机                               |
| ----------------------- | --------- | -------------------------------------- |
| `'idle'`（默认）        | follow-up | agent 回答完之后                       |
| `'step'`                | steer     | 下一个步边界，例如当前工具执行完之后   |
| `'now'`                 | interrupt | 立即取消当前这一步，已输出的部分被丢弃 |
| `(boundary) => boolean` | 自定义    | 条件为真的步边界                       |

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

`timing` 包含 `ms`；模型回合还有 `modelMs`、`firstTokenMs`，以及按工具调用 id 记录的 `toolMs`，都由事件算出（所以 `toolMs[id]` 等于该调用的 `tool_end.ms`）。summary 里的 `toolMs` 是各次调用耗时之和，并行调用会重叠，所以可能大于实际经过的时间。`usageOf` 只计算仍在历史里的消息，压缩掉的消息不再计入。
