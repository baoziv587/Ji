# 示例：用会话和插件使用 agent

可以直接运行的例子，以及它们用到的插件。插件代码在 [`src/plugins/`](src/plugins/)，可以直接复制到你的项目里改。

```bash
pnpm --filter @gaoxiang.ai/examples compaction   # 上下文压缩
pnpm --filter @gaoxiang.ai/examples truncate     # 剔除过大的工具结果
pnpm --filter @gaoxiang.ai/examples metrics      # 记录耗时和费用
pnpm --filter @gaoxiang.ai/examples interject    # 运行中插话：steer、follow-up、interrupt
pnpm --filter @gaoxiang.ai/examples hooks        # 细粒度钩子：自动继续、检索、兜底模型、预算
pnpm --filter @gaoxiang.ai/examples repl         # 极简 REPL：DeepSeek + clack，需要 DEEPSEEK_API_KEY
```

默认使用 pi-ai 的 faux provider 离线回放脚本。设置 `MODEL=anthropic/claude-sonnet-5`（或 pi-ai 支持的其他 `provider/model`）即可换成真实模型，API key 从环境变量读取。

## 1. 基本用法

只有四个对象：`Agent`（模型、工具、插件的组合）、`Session`（一段对话）、`Run`（一次运行）、`Plugin`（插件）。会话只有一个方法 `send`。

```ts
import { createAgent, createSession } from '@gaoxiang.ai/llm'

const agent = createAgent({
  model, // pi-ai 的 Model
  system: 'You are a helpful assistant.',
  tools: [readFile],
  plugins: [truncateToolResults(), compaction({ model, maxTokens: 100_000 })],
})
const chat = createSession(agent)

// 只要最终答案
const answer = await chat.send('hi').result

// 边生成边输出文字，结束后看统计
const r = chat.send('再详细一点')
for await (const chunk of r.text) {
  process.stdout.write(chunk)
}
const { usage, tools, modelMs } = await r.summary
```

`Run` 的成员：

| 成员        | 内容                                                                                                                         |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `r.text`    | 模型输出的文字增量，只包含开始读取之后的部分                                                                                 |
| `r.turns`   | 每一步一条记录：`turn`（这一步做了什么）、`state`、`timing`、`summary`（到这一步为止的统计）。无论何时开始读，都从第一步开始 |
| `r.summary` | 这次运行的统计：模型回合数、token、费用、模型耗时、每个工具的调用次数 / 出错次数 / 耗时                                      |
| `r.result`  | 最终回答                                                                                                                     |
| `r.state`   | 最终状态，可保存                                                                                                             |
| `r.abort()` | 取消                                                                                                                         |

提前退出任何 `for await` 都会取消这次运行。

**保存与恢复。** `chat.state` 和 `r.state` 是普通的 JSON 数据（消息历史 + 各插件的状态）。保存它，之后用 `createSession(agent, { state: saved })` 继续；插件列表可以换，新插件从初始状态开始。整段对话的累计用量用 `usageOf(chat.state)` 读取。

## 2. 运行中插话

```ts
chat.send('改用 vitest', { when: 'step' }) // steer：当前工具执行完后插入
chat.send('然后更新 changelog') // follow-up（默认）：等 agent 空闲时插入
chat.send('停，先列大纲', { when: 'now' }) // interrupt：取消当前这一步，马上插入
```

规则只有一条：每个步边界上，按发送顺序检查等待中的消息，条件成立就插入；每插入一条，agent 就不再空闲。所以多条 follow-up 会逐条处理，效果和每次等上一次运行结束再 `send` 相同。

agent 工作时，`send` 把消息并入当前的运行，返回的是同一个 `Run`；agent 空闲时开始一次新的运行。被 interrupt 取消的那一步不写入状态。

## 3. 写一个插件

```ts
import { after, before, definePlugin } from '@gaoxiang.ai/llm'

export const myPlugin = definePlugin({
  name: 'my-plugin', // 必填，不能和其他插件重名
  tools: [/* ... */], // 注册工具
  system: prompt => `${prompt}\nBe concise.`, // 修改 system prompt
  input: (messages, { state, idle }) => messages, // 这个步边界要插入的消息
  context: (messages, state) => messages, // 这次请求发给模型的消息，不改历史
  request: before(req => ({ ...req, options: { ...req.options, temperature: 0 } })), // 一次模型调用
  tool: after(result => result), // 一次工具调用
  update: (state, turn, next) => next(state, turn), // 写入状态
  state: { init: 0, reduce: (n, turn) => n + 1 }, // 插件自己的状态
})
```

钩子有两种形状：

- **变换**（`system`、`input`、`context`）：返回新的值。多个插件按数组顺序依次执行。
- **中间件**（`policy`、`request`、`env`、`tool`、`update`）：`(input, next)`。调用 `next` 并返回它的结果 = 什么都不改；改参数再调用 = 改输入；改返回值 = 改输出；不调用 = 拦截；调用多次 = 重试。只改输入或只改输出时，用 `before` / `after` 简写；只改流式增量（只影响显示）时，用 `request: mapDeltas(...)`。

**顺序。** 同一个钩子上，`plugins` 数组里后面的中间件在外层。不同钩子之间的顺序是固定的，所以写不同钩子的插件顺序可以随意。

**规则。**

- `update` 和 `state.reduce` 必须同步、纯（不读时钟、不发请求），否则保存后恢复的结果会不同。需要 IO 的事放在 `tool`、`request` 或 `policy` 里。
- `policy` 和 `request` 里消费 `next` 用 `return yield* next(...)`，这样取消能传到底层请求，返回值也不会丢。
- 工具出错、拦截、拒绝时返回 `toolError(call, reason)`，不要抛错。即使抛了，也会被转成错误结果交给模型。

## 4. 该写在哪里

| 我想……                                | 写在                                               | 例子                           |
| ------------------------------------- | -------------------------------------------------- | ------------------------------ |
| 修改工具参数、结果                    | `tool: before(...)` / `tool: after(...)`           | `truncateToolResults`          |
| 审批、拦截、超时、重试                | `tool`                                             | 不调用 `next` 即拦截           |
| 换模型、改 temperature / thinking     | `request: before(...)`                             | `hooks.ts` 的 `lowTemperature` |
| 模型出错时换兜底模型                  | `request`                                          | `hooks.ts` 的 `fallbackTo`     |
| 改写流式文字（只影响显示）            | `request: mapDeltas(...)`                          | 输出时遮盖密钥                 |
| 给这一次请求加检索结果、只发最近 N 条 | `context`                                          | `hooks.ts` 的 `retrieval`      |
| 自动继续、定时提醒                    | `input`                                            | `keepGoing`                    |
| 替换历史（压缩）                      | `policy` 返回 `rewriteHistory(messages)`           | `compaction`                   |
| 预算、步数上限                        | `policy` 返回 `stop(state)`                        | `budget`                       |
| 截断历史（不需要调用模型）            | `update`                                           | demo 里的 `keepLast`           |
| 保存一份插件自己的数据                | `state: { init, reduce }`                          | `keepGoing` 记录自动继续的次数 |
| 耗时、token、费用                     | 不写插件：`r.summary`、`r.turns`、`usageOf(state)` | `metrics.ts`                   |

## 5. 例子

### 上下文压缩 · [`compaction.ts`](src/plugins/compaction.ts)

```ts
compaction({ model: cheapModel, maxTokens: 100_000, keepRecent: 6 })
```

每次调用模型前估算上下文大小；超过 `maxTokens` 时，用 `cheapModel` 把较早的消息写成摘要，用「摘要 + 最近 `keepRecent` 条消息」替换历史。写摘要是 IO，在 `policy` 里做；替换本身由 `rewriteHistory` 交给 `update`，所以可以保存和重放。切点不会拆开工具调用和它的结果。被替换的消息需要另存时，从 `r.turns` 里 `turn.kind === 'rewrite'` 之前那一步的 `state` 读取。

### 剔除过大的工具结果 · [`truncate-tool-results.ts`](src/plugins/truncate-tool-results.ts)

```ts
truncateToolResults({ maxChars: 8_000 })
```

工具结果的文本超过 `maxChars` 时，保留开头约 70% 和结尾约 20%。只改工具的输出，所以写成 `tool: after(...)`。原始长度写在 `result.details.truncated.originalChars`：`details` 只保存在历史里，不会发给模型。

### 记录耗时和费用 · [`metrics.ts`](src/metrics.ts)

不需要插件：

```ts
const r = chat.send('...')

for await (const { timing, summary } of r.turns) {
  statusBar.set(`${timing.modelMs}ms · $${summary.usage.cost}`) // 每一步的耗时和到目前为止的累计
}

const { turns, usage, modelMs, toolMs, tools } = await r.summary // 整次运行
usageOf(chat.state) // 整段对话
```

faux provider 的费用恒为 0，换成真实模型后才有费用。

### 运行中插话 · [`interject.ts`](src/interject.ts)

工具执行期间发送 steer 和 follow-up：steer 在工具执行完后插入，follow-up 等 agent 回答完再插入；模型写 changelog 时发送 interrupt，写了一半的内容被丢弃。

### 细粒度钩子 · [`hooks.ts`](src/hooks.ts)

`input` 自动继续（[`keep-going.ts`](src/plugins/keep-going.ts)）、`context` 加检索结果、`request` 换兜底模型和改 temperature、`policy` 预算（[`budget.ts`](src/plugins/budget.ts)）组合在一个 agent 里。

### 极简 REPL · [`repl.ts`](src/repl.ts)

```bash
DEEPSEEK_API_KEY=sk-... pnpm --filter @gaoxiang.ai/examples repl
DEEPSEEK_MODEL=deepseek-v4-pro ...   # 换模型，默认 deepseek-v4-flash
DEEPSEEK_THINKING=high ...           # 打开思考，默认 off；可用档位 off / high / xhigh
```

用 [clack](https://bomb.sh/docs/clack/basics/getting-started/) 读输入。一个会话接一个 `send`，读 `Run` 本身（`for await (const e of r)`）：`text_delta` 边生成边写出，`toolcall_end` 显示工具名和参数，`act` 显示工具结果，等待模型或工具时显示状态行和已等待的秒数。

- 回答中按 Ctrl+C 调用 `r.abort()`，只停止这一次回答；会话回到发送前的状态，那条消息填回输入框，可以改了再发。出错时也一样。
- `/think <档位>` 在对话中切换思考档位：用新档位 `createAgent`，再用 `createSession(agent, { state: chat.state })` 接着聊。思考过程（`thinking_delta`）灰色显示。
- 在输入框按 Ctrl+C 或输入 `/exit` 退出。
- 状态行没有用 clack 的 `spinner`：它把 stdin 切到 raw 模式，Ctrl+C 会直接退出进程。
