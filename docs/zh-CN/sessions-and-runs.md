# 会话与运行

[English](../sessions-and-runs.md) · **简体中文** · [文档导航](README.md)

先完成一次对话，再按需要添加事件显示、运行中插话和状态恢复。以下示例假设你已选好 `model`，并配置了所需的 API key。

<br>

## 发送并读取回答

```ts
import { createAgent, createSession } from '@ji.dev/llm'

const agent = createAgent({ model, system: 'Be concise.' })
const chat = createSession(agent)
const r = chat.send('Hello')

for await (const chunk of r.text) process.stdout.write(chunk)
console.log(await r.summary)
```

`send` 返回 Run；文字通过 `r.text` 逐段到达，运行结束后 `r.summary` 给出统计。只要最终回答时，可以直接 `await chat.send('Hello').result`。

提前退出任何流式循环都会取消整次运行；[取消与恢复](#取消)说明如何处理。

<br>

## 三个对象

```ts
// 无状态，可复用
const agent = createAgent({
  model: 'deepseek/deepseek-flash',
  thinking,
  system,
  tools,
  plugins,
  ...streamOptions,
})

// 一段对话
const chat = createSession(agent, { state, maxSteps })

// 一次运行
const r = chat.send('hi')
```

- **Agent**：模型 + 工具 + 插件。它没有状态，一个 agent 可以服务多个会话。

  配置错误在创建 agent 时就暴露：模型不存在抛出 `UnknownModelError`（带最接近的候选），思考档位不受支持抛出 `UnsupportedThinkingError`（列出支持的档位），工具或插件重名抛出 `PluginConflictError`，并一次列出全部冲突。

- **Session**：持有 `state`（最后写入的状态）和 `pending`（尚未送达的消息）。方法是 `send` 和 `use`。
- **Run**：从第一步开始，到 agent 空闲、并且没有可送达的消息为止。

<br>

## 读取一次运行

所有成员共享同一次执行，可以同时读取多个。

| 成员               | 类型                        | 说明                                                                                                 |
| ------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------- |
| `r.text`           | `AsyncIterable<string>`     | 文字增量，从开始读取的那一刻算起                                                                     |
| `r.turns`          | `AsyncIterable<TurnEvent>`  | 每步一条：`turn`、`state`、`timing`、到这一步为止的 `summary`。**无论何时开始读，都从第 0 步开始**   |
| `r` 本身           | `AsyncIterable<RunEvent>`   | 这次运行的全部事件，按顺序，每个事件一个 `type`（[见下文](#事件)）                                   |
| `r.result`         | `Promise<AssistantMessage>` | 最终回答                                                                                             |
| `r.state`          | `Promise<AgentState>`       | 最终状态                                                                                             |
| `r.summary`        | `Promise<RunSummary>`       | 模型回合数、token、费用（含插件发起的模型调用）、模型和工具耗时，以及每个工具的调用 / 出错次数和耗时 |
| `r.abort(reason?)` |                             | 取消运行。尚未送达的消息留在会话里                                                                   |

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

<br>

## 取消

- 提前退出任何 `for await`（`break` 或抛出异常）都会**取消整次运行**。
- `r.abort()` 是显式的取消。
- 取消信号会传到正在进行的模型请求和正在执行的工具。工具通过 `run(args, signal)` 拿到它。

取消会停止后续执行，但不会撤销已经完成的工具副作用。当前未完成步骤不会写入状态。

已经显示的文字需要由界面自行标记为已中断。工具必须使用收到的 `signal` 才能及时停止它启动的 IO。

### 从错误中恢复

出错后，从最后写入的状态继续：

```ts
import { RunError } from '@ji.dev/llm'

try {
  await chat.send('Continue the task').result
} catch (error) {
  if (!(error instanceof RunError)) throw error
  console.error(error.kind, error.message)
  const recovered = createSession(agent, { state: error.state })
  // Save recovered.state or send a new instruction when ready.
}
```

恢复状态不会自动重试失败的步骤。原会话中尚未送达的消息仍在 `chat.pending`，它们不属于状态快照；新会话不会自动带上这些消息。

<br>

## 在 agent 工作时插话

运行进行中调用 `send`，消息会并入**同一次运行**，返回同一个 `Run`。`when` 决定消息在哪个步边界插入：

| `when`                  | 名称      | 送达时机                                       |
| ----------------------- | --------- | ---------------------------------------------- |
| `'idle'`（默认）        | follow-up | agent 回答完之后                               |
| `'step'`                | steer     | 下一个步边界，例如当前工具执行完之后           |
| `'now'`                 | interrupt | 立即取消当前这一步，未完成步骤的输出不写入历史 |
| `(boundary) => boolean` | 自定义    | 条件为真的步边界                               |

```ts
chat.send('改用 vitest', { when: 'step' })
chat.send('然后更新 changelog') // follow-up
chat.send('停，先列大纲', { when: 'now' })
```

**送达规则**：每个步边界上，按发送顺序检查等待中的消息，条件成立就插入。每插入一条，agent 就不再空闲，所以多条 follow-up 会逐条处理，效果和每次等上一次运行结束后再 `send` 相同。

<br>

## 保存与恢复

`chat.state` 是最后写入的 JSON 快照：`{ messages, plugins }`。成功运行后的快照用 `await r.state` 获取；快照不包含尚未送达的消息。

```ts
const saved = JSON.stringify(chat.state)
const chat2 = createSession(agent, { state: JSON.parse(saved) })
// 也可以直接从消息列表开始：
createSession(agent, { state: messages })
```

保存和恢复之间可以更换插件列表。没有保存过状态的插件从它的 `init` 开始。

<br>

## 模型与思考档位

`model` 写成 pi-ai 目录里的 `'provider/id'`，其他情况（自定义 `baseUrl`、faux provider）传 pi-ai 的 `Model` 对象。模型支持什么，agent 自己知道，不需要再去问 pi-ai：

```ts
const agent = createAgent({ model: 'deepseek/deepseek-flash', thinking: 'high' })
agent.model.thinkingLevels // ['off', 'high', 'xhigh']
agent.thinking // 'high'
await agent.model.hasKey() // 此刻是否有 DeepSeek 的 key，环境变量或存下来的都算
```

`thinking` 取 `'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'`，默认 `'off'`；对总是思考的模型，默认取它最轻的档位。模型不支持的档位在 `createAgent` 时就报错，不会被悄悄换掉。创建 agent 之前（比如做模型选择界面）用 `findModel(spec)`、`listModels(provider?)` 拿到同样的信息。

- **对话中途换档**：`chat.use(agent.with({ thinking: 'xhigh' }))`。`with` 返回一个新 agent，原来的不变；`use` 在下一个步边界生效，状态、排队的消息和正在进行的运行都保留。
- **按请求改**：写一个 `request: before(req => ({ ...req, thinking: 'xhigh' }))` 插件。插件也可能换了模型，所以这里的档位会映射到这次请求的模型支持的最近一档，实际发出的档位在 `model_start` 里报告。
- **API key**：库不替你检查，因为 key 也可能来自 `apiKey` 或 request 插件。在用户准备发送时检查 `await agent.model.hasKey()`，而不是一开始就拦住。

<br>

## 上限

`maxSteps`（默认 64）限制一次运行的步数。插入消息、结束运行各占一步。超出上限时运行失败。

<br>

## 统计，不需要插件

```ts
for await (const { timing, summary } of r.turns) {
  // 每一步的耗时，以及到目前为止的累计
}
const { turns, usage, modelMs, toolMs, tools } = await r.summary // 这次运行
usageOf(chat.state) // 整段对话
```

`timing` 包含 `ms`；模型回合还有 `modelMs`、`firstTokenMs`，以及按工具调用 id 记录的 `toolMs`，都由事件算出（所以 `toolMs[id]` 等于该调用的 `tool_end.ms`）。summary 里的 `toolMs` 是各次调用耗时之和，并行调用会重叠，所以可能大于实际经过的时间。`r.summary.usage` 和 `usageOf` 统计的东西不同，两者不必相等：

- `r.summary.usage` 累加这次运行发布的每个 `model_end` 和 `model_error` 的用量，包括插件 `ctx.complete` 的调用。一步之后即使被取消、`stop` 或改写历史，已经花掉的用量也不会撤销。被中断而没有终态事件的调用拿不到用量，不计入。
- `usageOf(state)` 累加仍在历史里的主模型消息。插件的调用和被压缩掉的消息都不在内。

<br>

## 事件

读 `r` 得到一条扁平的事件流，按 `e.type` 判别即可。每个事件还带有步号 `t`。

| 事件                      | 什么时候                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------- |
| `step_start` / `step_end` | 一步开始 / 写入状态。`step_end` 与 `r.turns` 的每一项相同                                               |
| `step_cancelled`          | 一步在写入前被中断或取消。`open` 列出仍在运行的工具调用                                                 |
| `model_start`             | 请求发出：实际使用的模型和思考档位，以及 `by`（见下文）                                                 |
| `thinking` / `text`       | 主模型的输出，字段是 `delta`                                                                            |
| `tool_call_delta`         | 模型正在写一次调用的参数：`call` 带着已写出的参数和之后 `tool_call` 用的 id，`delta` 是 JSON 新写的一段 |
| `tool_call`               | 模型写完了一次调用的参数。**工具还没开始执行**                                                          |
| `model_end`               | 调用成功：完整的消息，带用量和 `ms`                                                                     |
| `model_error`             | 调用失败：`error`、服务商报告的 `usage`（如果有）和 `ms`。request 插件可能重试                          |
| `tool_start` / `tool_end` | 工具真正开始 / 得到结果，带 `ms`。并行的调用按完成顺序结束                                              |
| `tool_update`             | 工具 yield 的一个值（见下文）                                                                           |
| `run_end`                 | 运行结束：`outcome` 为 `'done'` 带结果，或为 `'failed'` 带 `RunError`                                   |
| `<插件名>:<事件>`         | 插件 yield 的事件（[编写插件](plugins.md#插件发出的事件)）                                              |

每个 `tool_start` 都会被它的 `tool_end` 或这一步的 `step_cancelled` 关闭，界面上不会留下一直转的 spinner。同样，每个 `model_start` 恰好被一个 `model_end`、`model_error` 或 `step_cancelled` 关闭；同一时刻至多有一次模型调用在进行，所以按出现顺序就能配对。

**`by`**：插件可以用 [`ctx.complete`](plugins.md#调用模型ctxcomplete) 自己调用模型，比如写摘要。这些调用的 `model_start`、`model_end`、`model_error` 带 `by: '<插件名>'`，主模型的调用没有 `by`。它们的 `thinking`、`text`、`tool_call_delta`、`tool_call` 不进入流，所以 `r.text` 始终只有主模型的回答。

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

### 工具的中间更新

`run` 写成异步生成器的工具可以边做边报告。每个 `yield` 成为一个 `tool_update`（任意值：数字、字符串、对象），`return` 的值是结果。取消时它的 `finally` 照常执行。

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

### 日志与追踪

`for await` 循环抛错或提前退出会取消整次运行，而且它只能看到一次运行。日志、追踪、指标请用插件的只读钩子 `observe`：它从第一个事件起收到这个 agent 每次运行的全部事件，抛出的异常只会作为警告报告，不影响运行。

`observe` 是同步的，不会被等待：要异步导出，就在 `observe` 里入队，运行结束后再 flush（[示例](plugins.md#observer-是同步的)）。现成的插件在 [`plugins/`](../../plugins)：`@ji.dev/plugin-otel`、`@ji.dev/plugin-jsonl`。

<br>

## 继续阅读

[编写插件](plugins.md) · [核心概念](concepts.md) · [文档导航](README.md)
