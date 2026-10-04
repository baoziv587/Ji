# 示例：用会话和插件使用 agent

可以直接运行的例子，以及它们用到的插件。插件代码在 [`src/plugins/`](src/plugins/)，可以直接复制到你的项目里改。

```bash
pnpm --filter @ji.dev/examples compaction   # 上下文压缩
pnpm --filter @ji.dev/examples truncate     # 剔除过大的工具结果
pnpm --filter @ji.dev/examples metrics      # 记录耗时和费用
pnpm --filter @ji.dev/examples interject    # 运行中插话：steer、follow-up、interrupt
pnpm --filter @ji.dev/examples hooks        # 细粒度钩子：自动继续、检索、兜底模型、预算
pnpm --filter @ji.dev/examples repl         # 极简 REPL：DeepSeek + clack，需要 DEEPSEEK_API_KEY
```

默认使用 pi-ai 的 faux provider 离线回放脚本。设置 `MODEL=anthropic/claude-sonnet-5`（或 pi-ai 支持的其他 `provider/model`）即可换成真实模型，API key 从环境变量读取。

## 1. 基本用法

只有四个对象：`Agent`（模型、工具、插件的组合）、`Session`（一段对话）、`Run`（一次运行）、`Plugin`（插件）。会话只有一个方法 `send`。

```ts
import { createAgent, createSession } from '@ji.dev/llm'

const agent = createAgent({
  model, // pi-ai 的 Model
  system: 'You are a helpful assistant.',
  tools: [readFile],
  plugins: [truncateToolResults(), compaction({ maxTokens: 100_000 })],
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
| `r.summary` | 这次运行的统计：模型回合数、token、费用（含插件发起的模型调用）、模型耗时、每个工具的调用次数 / 出错次数 / 耗时              |
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
import { after, before, definePlugin } from '@ji.dev/llm'

export const myPlugin = definePlugin({
  name: 'my-plugin', // 必填，不能和其他插件重名
  tools: [/* ... */], // 注册工具
  system: prompt => `${prompt}\nBe concise.`, // 修改 system prompt
  input: (messages, { state, idle, own }) => messages, // 这个步边界要插入的消息
  request: before(req => ({ ...req, options: { ...req.options, temperature: 0 } })), // 一次模型调用
  toolCall: after(result => result), // 一次工具调用
  record: (input, next) => next(input), // 写入状态
  state: { init: 0, reduce: (n, turn) => n + 1 }, // 插件自己的状态
})
```

钩子只有两种签名：

- **变换**（`input`）：`(value, ctx) => value`，可以是异步的。多个插件按数组顺序依次执行。
- **中间件**（`decide`、`request`、`toolCalls`、`toolCall`）：`(input, next, ctx)`。调用 `next` 并返回它的结果 = 什么都不改；改参数再调用 = 改输入；改返回值 = 改输出；不调用 = 拦截；调用多次 = 重试。

`system(prompt)`、`record({ state, turn }, next)`、`state.reduce(own, turn)` 是纯函数，没有 `ctx`。

**`ctx`。** `ctx.state` 是这一步开始前已提交的状态，同一步里所有钩子看到同一个快照；`ctx.own` 是本插件自己的状态（等于 `plugin.select(ctx.state)`，类型由 `state.init` 推断）；`ctx.signal` 在中断或取消时触发，钩子里的 IO 都要接上它。`input` 还有 `ctx.idle`，`decide` 还有 `ctx.complete`（经过 request 链调用模型），`request` 还有 `ctx.by`（发起辅助调用的插件名）。

**不写生成器。** 只改输入用 `before(f)`，只改结果用 `after(g)`，满足条件时拦截用 `intercept(f)`（返回值即结果，返回 `undefined` 放行），只改流式事件（只影响显示）用 `mapEvents(f)`。前三个的回调可以是异步的。要发自己的事件、重试或调用模型时，才需要写 `async function*`。

```ts
decide: intercept(state => (overBudget(state) ? stop(state) : undefined)) // 超预算就停
```

**顺序。** 插件列表从上到下就是从外到内：同一个中间件钩子上，靠前的插件在外层，先看到输入、最后看到输出。不同钩子之间的顺序是固定的，所以写不同钩子的插件顺序可以随意。嵌套的预设会被展开，同一个插件对象只登记一次。

**规则。**

- `record` 和 `state.reduce` 必须同步、纯（不读时钟、不发请求），否则保存后恢复的结果会不同。需要 IO 的事放在 `decide`、`input`、`request`、`toolCalls` 或 `toolCall` 里，并传入 `ctx.signal`。
- 流式中间件里消费 `next` 用 `return yield* next(...)`，这样取消能传到底层请求，返回值也不会丢。
- 工具拦截、拒绝等预期内的失败返回 `toolError(call, reason)`；重试可能解决的失败直接抛出，外层 `toolCall` 中间件可以重试，没人处理时也会被转成错误结果交给模型。
- 不要原地修改状态。开发时（`NODE_ENV` 为 `development` / `test`）已提交的状态会被冻结，原地修改当场抛出 `TypeError`。
- `observe` 是同步的，不会被等待；异步导出日志要在 `observe` 里入队，运行结束后自己 flush。

完整说明见 [编写插件](../../docs/zh-CN/plugins.md)。

## 4. 该写在哪里

| 我想……                                | 写在                                               | 例子                           |
| ------------------------------------- | -------------------------------------------------- | ------------------------------ |
| 修改工具参数、结果                    | `toolCall: before(...)` / `toolCall: after(...)`   | `truncateToolResults`          |
| 审批、拦截                            | `toolCall: intercept(...)`                         | 返回 `toolError` 即拦截        |
| 重试                                  | `toolCall`                                         | 只重试可以安全重复的调用       |
| 一个回合的工具调用逐个执行            | `toolCalls`                                        | `sequentialTools`              |
| 换模型、改 temperature / thinking     | `request: before(...)`                             | `hooks.ts` 的 `lowTemperature` |
| 模型出错时换兜底模型                  | `request`                                          | `hooks.ts` 的 `fallbackTo`     |
| 改写流式文字（只影响显示）            | `request: mapEvents(...)`                          | 输出时遮盖密钥                 |
| 给这一次请求加检索结果、只发最近 N 条 | `request: before(...)`，跳过带 `ctx.by` 的调用     | `hooks.ts` 的 `retrieval`      |
| 自动继续、定时提醒                    | `input`                                            | `keepGoing`                    |
| 替换历史（压缩）                      | `decide` 里 `ctx.complete`，返回 `rewriteHistory`  | `compaction`                   |
| 预算、步数上限                        | `decide: intercept(...)` 返回 `stop(state)`        | `budget`                       |
| 截断历史（不需要调用模型）            | `record`                                           | demo 里的 `keepLast`           |
| 保存一份插件自己的数据                | `state: { init, reduce }`，用 `ctx.own` 读取       | `keepGoing` 记录自动继续的次数 |
| 耗时、token、费用                     | 不写插件：`r.summary`、`r.turns`、`usageOf(state)` | `metrics.ts`                   |

## 5. 例子

### 上下文压缩 · [`compaction.ts`](src/plugins/compaction.ts)

```ts
compaction({ maxTokens: 100_000, keepRecent: 6 })
compaction({ maxTokens: 100_000, model: cheapModel, timeoutMs: 30_000 })
```

每次调用模型前估算上下文大小；超过 `maxTokens` 时，把较早的消息写成摘要，用「摘要 + 最近 `keepRecent` 条消息」替换历史。写摘要是 IO，在 `decide` 里通过 `ctx.complete` 做：默认用 agent 的模型，可以用 `model` 换成便宜的；它经过 request 插件（兜底模型照样生效），随这一步一起取消，事件带 `by: 'compaction'`，用量计入 `r.summary.usage`，摘要的文字不会出现在 `r.text` 里。设了 `timeoutMs` 时，超时就放弃这次压缩，这一步保留原来的历史。替换本身由 `rewriteHistory` 交给 `record`，所以可以保存和重放。切点不会拆开工具调用和它的结果。被替换的消息需要另存时，从 `r.turns` 里 `turn.kind === 'rewrite'` 之前那一步的 `state` 读取。

### 剔除过大的工具结果 · [`truncate-tool-results.ts`](src/plugins/truncate-tool-results.ts)

```ts
truncateToolResults({ maxChars: 8_000 })
```

工具结果的文本超过 `maxChars` 时，保留开头约 70% 和结尾约 20%。只改工具的输出，所以写成 `toolCall: after(...)`。原始长度写在 `result.details.truncated.originalChars`：`details` 只保存在历史里，不会发给模型。

### 工具调用逐个执行 · [`sequential-tools.ts`](src/plugins/sequential-tools.ts)

```ts
sequentialTools()
```

默认情况下，一个回合的工具调用同时开始；装上它以后改为一个接一个执行，适合会写同一批文件的工具。这件事只能在 `toolCalls` 里做：`toolCall` 运行时，这批调用已经并排启动了，每个 `toolCall` 只看得到自己那一次。`toolCalls` 看得到整批，于是把调用逐个交给 `next`，每次只放一个调用。写进历史的仍是模型原来那条含全部调用的消息，工具结果也按调用顺序排列。

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

`r.summary.usage` 按模型事件累加，包括插件发起的模型调用（比如写摘要），已经花掉的不会因为这一步被取消而撤销；`usageOf` 只统计仍在历史里的主模型消息。所以两者不必相等。faux provider 的费用恒为 0，换成真实模型后才有费用。

### 运行中插话 · [`interject.ts`](src/interject.ts)

工具执行期间发送 steer 和 follow-up：steer 在工具执行完后插入，follow-up 等 agent 回答完再插入；模型写 changelog 时发送 interrupt，写了一半的内容被丢弃。

### 细粒度钩子 · [`hooks.ts`](src/hooks.ts)

`input` 自动继续（[`keep-going.ts`](src/plugins/keep-going.ts)，用 `ctx.own` 读取已继续的次数）、`request` 加检索结果（跳过 `ctx.complete` 发起的请求）、换兜底模型和改 temperature、`decide` 预算（[`budget.ts`](src/plugins/budget.ts)，用 `intercept`）组合在一个 agent 里。兜底模型只在还没有任何输出时才切换，这一步被取消后也不再重试。`lowTemperature` 排在 `fallbackTo` 前面，处在外层，所以第一次请求和兜底请求都用 temperature 0。

`budget` 按 `usageOf(state)` 计算，看不到插件的模型调用和被压缩掉的消息，所以不是严格的费用上限。

### 极简 REPL · [`repl.ts`](src/repl.ts)

```bash
DEEPSEEK_API_KEY=sk-... pnpm --filter @ji.dev/examples repl
DEEPSEEK_MODEL=deepseek-v4-pro ...   # 换模型，默认 deepseek-v4-flash
DEEPSEEK_THINKING=high ...           # 打开思考，默认 off；可用档位 off / high / xhigh
```

用 [clack](https://bomb.sh/docs/clack/basics/getting-started/) 读输入。一个会话接一个 `send`，读 `Run` 本身（`for await (const e of r)`）：`text` 边生成边写出，`tool_call` 显示工具名和参数，`tool_end` 显示工具结果，等待模型或工具时显示状态行和已等待的秒数。

- 回答中按 Ctrl+C 调用 `r.abort()`，只停止这一次回答；会话回到发送前的状态，那条消息填回输入框，可以改了再发。出错时也一样。
- `/think <档位>` 在对话中切换思考档位：用新档位 `createAgent`，再用 `createSession(agent, { state: chat.state })` 接着聊。思考过程（`thinking`）灰色显示。
- 在输入框按 Ctrl+C 或输入 `/exit` 退出。
- 装了 [`@ji.dev/plugin-files`](../../plugins/files/src/index.ts) 的 `read` 和 `edit`：模型可以读写运行命令时所在目录下的文件，目录之外的路径会被拒绝。回答被 Ctrl+C 停止时会话回滚，但已经写入磁盘的修改不会撤销；模型下次修改那个文件前会被要求重新读取。
- 每次读文件前、每次改文件写入前（先显示 diff）都要等你选 Yes / No。Shift+Tab 在“逐个确认”和“自动同意”之间切换：输入框标题会显示当前模式；在确认问题上按 Shift+Tab 会切到自动同意并同意这一个。
- 审批按 RFC-0007 的写法：`approval({ previews: [fileTools.preview, reading] })` 在 `toolCall` 层 `yield` 一个 `ask:choice` 事件，这个 `yield` 的值就是选择；`answerer({ answer })` 在 `toolCalls` 层回答它，`answer` 负责问人或在自动模式下直接回答 `yes`。两个插件都不认识文件和终端：`preview` 说明一次调用将做什么。换成 `previews: [named('bash')]` 或不传，就能审批任何工具。
- 状态行没有用 clack 的 `spinner`：它把 stdin 切到 raw 模式，Ctrl+C 会直接退出进程。
