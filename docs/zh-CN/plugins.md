# 编写插件

[English](../plugins.md) · **简体中文**

插件是一组挂在 agent loop 上、有名字的钩子。它和 Rollup、Vite 的插件是同一种形状：一个带 `name` 的对象，字段是在流程固定位置被调用的钩子。这里的流程就是 agent loop，所以选哪个钩子，就是选你的代码在 loop 的哪个位置运行、多久运行一次。

```ts
import { after, before, definePlugin } from '@gaoxiang.ai/llm'

export const myPlugin = definePlugin({
  name: 'my-plugin', // 必填，不能重名
  tools: [/* AgentTool */],
  system: prompt => `${prompt}\nBe concise.`,
  input: (messages, { state, idle, own }) => messages,
  request: before(req => ({
    ...req,
    options: { ...req.options, temperature: 0 },
  })),
  toolCall: after(result => result),
  record: (input, next) => next(input),
  state: { init: 0, reduce: (n, turn) => n + 1 },
  observe: (e, run) => log(run.id, e.type),
})
```

## agent loop

每个钩子的位置和运行频率。一次运行会反复执行步骤，直到 agent 空闲、也没有排队的消息：

```text
createAgent        tools、system                           一次
run                observe                                 这次运行的每个事件，按顺序
 └─ step
     decide        决定这一步做什么                         每一步
      ├─ input     这里要插入消息吗？                        有：一个 input turn，直接到 record
      │                                                     没有且空闲：运行结束
      └─ request   一次模型调用                             每个 ctx.complete 也经过它
     toolCalls     这个模型回合的全部工具调用，一起          只有带工具调用的回合
      └─ toolCall  一次调用，与同回合的其他调用并行          每次工具调用
     record        把这一步的 turn 写入历史                  每一步
      └─ state.reduce  各插件自己的数据                     所属插件的 record 层返回时
```

`input`、`request` 都在 `decide` 里面：`decide` 不调用 `next`、直接返回 `rewriteHistory(...)` 或 `stop(state)` 时，它们都不会执行，改写历史直接进入 `record`。工具不在里面：`decide` 的 `next` 返回时，模型已经回答，但还没有任何工具执行。

## 钩子

| 钩子           | 类型   | 运行时机                                 | 能发事件 | 典型用途                       |
| -------------- | ------ | ---------------------------------------- | -------- | ------------------------------ |
| `tools`        | 列表   | `createAgent` 时                         | —        | 注册工具                       |
| `system`       | 变换   | `createAgent` 时执行一次                 | 否       | 修改 system prompt             |
| `decide`       | 中间件 | 每一步                                   | 是       | 压缩、预算、结束运行           |
| `input`        | 变换   | 每个步边界                               | 否       | 自动继续、提醒                 |
| `request`      | 中间件 | 每次模型调用，包括 `ctx.complete` 发起的 | 是       | 换模型、兜底、检索、窗口截取   |
| `toolCalls`    | 中间件 | 每个带工具调用的回合一次：整批调用       | 是       | 逐个执行工具调用、一次审批整批 |
| `toolCall`     | 中间件 | 每次工具调用，与同回合的其他调用并行     | 是       | 截断、审批、重试、节流更新     |
| `record`       | 纯函数 | 每一步                                   | 否       | 裁剪历史                       |
| `state.reduce` | 纯函数 | 每一步，所属插件的 `record` 层返回时     | 否       | 插件自己的数据                 |
| `observe`      | 观察者 | 每次运行的每个事件                       | 否       | 日志、追踪、指标。只读         |

**类型**说明钩子怎么组合：变换把一个值沿插件列表依次传下去；中间件包住它里面的各层（`next`）；纯函数是同步函数，没有 `ctx`，不能做 IO；观察者只看不改。**能发事件**说明这个钩子能不能往运行里追加自己的事件（见[插件发出的事件](#插件发出的事件)）。

### 一次调用，还是一整批

命名遵循一条规则：单数的钩子包住一次，复数的钩子包住一整批。`toolCall` 和 `toolCalls` 分别位于"这一回合的调用开始一起执行"这个点的两侧：

```text
toolCalls( message )            看得到这一回合的全部调用
  └─ 一起开始执行               调用在这里同时启动
       ├─ toolCall( call a )    只看得到自己这一次
       └─ toolCall( call b )
```

关于单次调用的事（它的参数、它的结果、它能不能执行）放在 `toolCall`。关于这批调用整体的事放在 `toolCalls`，比如逐个执行、在一次确认里审批全部调用、拒绝调用次数过多的回合。原因是 `toolCall` 运行时，这批调用已经并排启动，彼此都不知道对方存在。[`sequential-tools.ts`](../../apps/examples/src/plugins/sequential-tools.ts) 把调用一个一个交给 `next`：只含一次调用的消息，就是只有一个调用的一批。

改历史用 `record`，存自己的数据用 `state`。在插件外部用 `myPlugin.select(state)` 读取插件状态，插件还没写入时返回 `init`；在插件自己的钩子里，`ctx.own` 就是同一个值。

## 两种签名

```text
变换      (value, ctx) => value | Promise<value>          input
中间件    (input, next, ctx) => Stream<Payload, output>   decide、request、toolCalls、toolCall
纯函数    没有 ctx                                        system(prompt)、record({ state, turn }, next)、state.reduce(own, turn)
```

**变换**：按插件列表顺序依次执行，每个插件拿到上一个的结果。可以是异步的。

**中间件**：

| 写法                | 效果       |
| ------------------- | ---------- |
| 返回 `next(input)`  | 什么都不改 |
| 改参数后调用 `next` | 改输入     |
| 改 `next` 的返回值  | 改输出     |
| 不调用 `next`       | 拦截       |
| 多次调用 `next`     | 重试       |

有副作用的四个中间件（`decide`、`request`、`toolCalls`、`toolCall`）都是**流**：`yield` 往这次运行追加一个事件，`return` 给出结果，`yield* next(...)` 把内层的事件原样传出去。`record` 也是 `(input, next)` 的形状，但它是普通的同步函数：`record: ({ state, turn }, next) => AgentState`。

## `ctx`

带 `ctx` 的钩子都有下面三个字段，个别钩子多一个。

| 字段           | 出现在            | 含义                                                                    |
| -------------- | ----------------- | ----------------------------------------------------------------------- |
| `ctx.state`    | 所有带 ctx 的钩子 | 这一步开始前已提交的状态。同一步里所有钩子看到同一个快照                |
| `ctx.own`      | 所有带 ctx 的钩子 | 本插件的状态，即 `plugin.select(ctx.state)`。类型由 `state.init` 推断   |
| `ctx.signal`   | 所有带 ctx 的钩子 | 这一步被中断或运行被取消时触发。钩子发起的任何 IO 都把它传下去          |
| `ctx.idle`     | `input`           | 历史为空，或最后一条是没有工具调用的助手消息                            |
| `ctx.complete` | `decide`          | 经过 agent 的 request 链调用模型（[见下文](#调用模型ctxcomplete)）      |
| `ctx.by`       | `request`         | 发起这次请求的插件名（通过 `ctx.complete`）；主模型的请求为 `undefined` |

有状态的插件读自己的状态，不需要引用自己，也不需要写类型：

```ts
export const keepGoing = ({ isDone, maxTimes = 3, prompt = 'Keep going until the task is done.' }: KeepGoingOptions) =>
  definePlugin({
    name: 'keep-going',
    state: { init: 0, reduce: (n, turn) => (isNudge(turn, prompt) ? n + 1 : n) },
    input: (messages, { state, idle, own }) =>
      idle && messages.length === 0 && !isDone(state) && own < maxTimes ? [user(prompt)] : messages,
  })
```

任何钩子里的 IO 都接上信号，这样中断时它会被取消，而不是继续跑完：

```ts
const enrich = definePlugin({
  name: 'enrich',
  request: before(async (req, { by, signal }) => {
    if (by !== undefined) return req // 其他插件用 ctx.complete 发起的请求不动
    const response = await fetch('https://example.com/context', { signal })
    return { ...req, messages: [user(await response.text()), ...req.messages] }
  }),
})
```

`req.messages` 一开始就是历史；改它只改变这一次请求发送的内容，不会写进历史：写入历史的是模型的回复，从来不是 `req.messages`。所以检索、窗口截取都写成 `request: before(...)`。每个 `ctx.complete` 也经过 `request`，除非这些调用也该一起改，否则要判断 `ctx.by`。

不要原地修改 `ctx.state` 或 `ctx.own`，要返回新值。打开[开发检查](#开发检查)时，`ctx.own.count++` 这样的写入会在那一行抛出 `TypeError`。

## 辅助函数：不写生成器

| 我想……                         | 写法              | 需要懂生成器 |
| ------------------------------ | ----------------- | ------------ |
| 改输入                         | `before(f)`       | 否           |
| 改结果                         | `after(g)`        | 否           |
| 满足条件时拦截                 | `intercept(f)`    | 否           |
| 逐个改事件（只影响读者看到的） | `mapEvents(f)`    | 否           |
| 发自己的事件、重试、调用模型   | `async function*` | 是           |

```text
before(f)     f(input, ctx)         => input | Promise<input>
after(g)      g(output, input, ctx) => output | Promise<output>
intercept(f)  f(input, ctx)         => output | undefined | Promise<output | undefined>
mapEvents(f)  f(event, input, ctx)  => event
```

`intercept` 的回调返回一个值，就以它为结果，不调用 `next`；返回 `undefined` 就原样放行。四个流式钩子的结果都不可能是 `undefined`，所以不会有歧义。

```ts
// 预算：超了就停
decide: intercept(state => (overBudget(state) ? stop(state) : undefined))

// 审批：拒绝时直接给模型一个错误结果
toolCall: intercept(async (call, { signal }) =>
  (await askApproval(call, { signal })) ? undefined : toolError(call, 'User denied this call'),
)
```

- `before`、`after`、`intercept` 的回调可以是异步的。回调结束后它们会检查 `ctx.signal`：这一步已被取消时，不再启动 `next`，也不返回迟到的结果。它们停不下回调本身，所以回调里的 IO 要接上 `ctx.signal`。
- `after` 原样转发事件，只变换最终结果；`mapEvents` 同步地逐个改写事件，一进一出，结果不变。事件只会到达运行的读者，要同时改流式文字和写入状态的消息（比如遮盖密钥），就两个一起用。
- 辅助函数只用于四个流式钩子。`record` 直接写普通函数：`record: (input, next) => trim(next(input))`。

## 调用模型：`ctx.complete`

在 `decide` 里，`ctx.complete(req, { signal? })` 借助 agent 自己的机制调用模型，不需要导入 pi-ai：

```ts
const summarize = definePlugin({
  name: 'summarize',
  async *decide(state, next, { complete }) {
    if (!tooLong(state.messages)) return yield* next(state)

    const reply = yield* complete({
      systemPrompt: 'Summarize the conversation below for an assistant that will continue it.',
      messages: [user(transcript(state.messages))],
    })
    return rewriteHistory([user(textOf(reply))])
  },
})
```

- 只有 `messages` 必填。`model`、`thinking`、`options` 默认取 agent 的；`systemPrompt` 默认 `''`，`tools` 默认 `[]`。想用便宜的模型就传 `model: cheapModel`。
- 它经过完整的 `request` 链，fallback 等 request 插件照常生效。这些插件看到 `ctx.by === '<插件名>'`，能与主模型的请求区分开：

  ```ts
  request: before((req, { by }) => (by === undefined ? { ...req, model: mainModel } : req))
  ```

- 它随这一步一起取消。它的 `thinking`、`text`、`tool_call` 事件不进入流，所以 `r.text` 只有主模型的回答；它的 `model_start`、`model_end`、`model_error` 带 `by: '<插件名>'`，用量计入 `r.summary.usage`。
- 同一时刻只能有一次调用：同时发起多个 `complete`（例如用 `merge`）不受支持。
- `request` 钩子里没有 `complete`：那次调用会再次经过这个钩子本身。

可选的 `signal` 只收窄这次调用：它与这一步的信号合并，能提前结束这一次调用，但不能让调用比已取消的步骤活得更久。下面的压缩在 30 秒内写不完摘要就放弃，这一步保留原来的长历史：

```ts
const compaction = definePlugin({
  name: 'compaction',
  async *decide(state, next, { complete, signal }) {
    if (!tooLong(state.messages)) return yield* next(state)

    const deadline = AbortSignal.timeout(30_000)
    let reply: AssistantMessage
    try {
      const req = { systemPrompt: SUMMARIZE, messages: [user(transcript(state.messages))] }
      reply = yield* complete(req, { signal: deadline })
    } catch (error) {
      // 只处理自己的时限；步骤被取消或模型出错照常向上抛
      if (signal.aborted || !deadline.aborted) throw error
      return yield* next(state)
    }
    return rewriteHistory([user(textOf(reply)), ...recent(state.messages)])
  },
})
```

完整版本（切点不会拆开工具调用和它的结果）见 [`compaction.ts`](../../apps/examples/src/plugins/compaction.ts)。

## 顺序

插件列表从上到下，就是从外到内：

```text
plugins: [a, b]

变换      input                    a 先处理，再交给 b
中间件    decide / request / ...   a 在外层：a 先看到输入，最后看到输出
record    a( b( applyTurn ) )      每个 state.reduce 在所属层返回时执行：先 b，后 a
observe   a，然后 b                每个事件都按列表顺序
```

- **同一个钩子**：与 Koa 的 `app.use(a); app.use(b)` 相同。预算要在审计记录之前决定是否放行，就写成 `[budget, audit]`。
- **不同钩子**：顺序由一步的结构固定，所以写不同钩子的插件怎么排都行。
- **预设**：`plugins` 可以嵌套数组。列表先展开，再按对象去重，保留第一次出现的位置：`[a, [b, a]]` 等价于 `[a, b]`。同一个插件对象的工具、钩子、reducer 和 observer 都只登记一次，状态也不会重复累计。不同对象使用同一个名字仍抛出 `PluginConflictError`。`agent.with(...)` 同样适用。

内核的 `extend(base, m1, m2)` 让 `m2` 在外层；LLM 层把列表反过来再交给它（见 [内核 API](kernel.md)）。

## 错误与重试

| 情况                                 | 怎么做                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| 重试可能解决的工具失败（网络、限流） | 抛出。外层 `toolCall` 中间件可以重试；没人处理时转成给模型的错误结果           |
| 预期内的拒绝或业务失败               | 返回 `toolError(call, reason)`。它是一个结果，不会进入 `catch`                 |
| 模型请求或其他钩子抛错               | 向外传播。运行以 `RunError` 失败，`cause` 是原始错误，`state` 是最后提交的状态 |
| 运行被取消或这一步被中断             | 结束。不要重试，也不要改写成“工具失败，继续执行”                               |

框架不会自动重试。重试插件自己决定重试什么、重试几次、怎么退避，并在信号触发后停下。有副作用的工具（写入、发送、付款）只有在幂等时才能重试。模型已经输出了用户看得见的内容之后，fallback 不能再拼上第二个回答：[`hooks.ts`](../../apps/examples/src/hooks.ts) 的 `fallbackTo` 只在还没有任何输出时才换模型。

```ts
import { setTimeout as delay } from 'node:timers/promises'

const safeToRepeat = new Set(['read_file', 'search_docs'])

const retryReads = definePlugin({
  name: 'retry-reads',
  async *toolCall(call, next, { signal }) {
    for (let attempt = 1; ; attempt++) {
      try {
        return yield* next(call) // isError 结果是返回值，不重试
      } catch (error) {
        signal.throwIfAborted() // 运行已取消就不再重试
        if (attempt >= 3 || !safeToRepeat.has(call.name) || !isTransient(error)) throw error
      }
      await delay(100 * 2 ** (attempt - 1), undefined, { signal })
    }
  },
})
```

每次尝试的事件都留在运行里。

## observer 是同步的

`observe(e, run)` 对每个事件同步调用，从不等待。它抛出的错误会报告为 `ObserveWarning`，带插件名和事件类型；其他 observer 和这次运行照常继续。返回 Promise 的 observe（`observe: async e => ...`）会收到一次 `ObserveWarning`，说明它不会被等待；它的 rejection 也会被捕获并报告为警告。没有人等待这些异步工作，也不保证它们的完成顺序。

要异步导出事件，就在 `observe` 里同步入队，运行结束后自己 flush 并关闭队列。`r.result` 和 `run_end` 不代表导出已经完成。

```ts
let tail = Promise.resolve()
let pending = 0
const exportErrors: unknown[] = []

const log = definePlugin({
  name: 'queued-log',
  observe(event, run) {
    if (pending >= 1_000) throw new Error('Log queue full; event dropped') // 报告为 ObserveWarning
    pending++
    tail = tail
      .then(() => sink.write(event, run))
      .catch(error => {
        exportErrors.push(error)
      })
      .finally(() => {
        pending--
      })
    // 不返回 tail：observe 只负责入队
  },
})

const session = createSession(createAgent({ model, plugins: [log] }))
try {
  await session.send('Hello').result
} finally {
  await tail // flush：运行已结束，不会再有事件入队
  try {
    await sink.close()
  } finally {
    for (const error of exportErrors) console.error('Log export failed', error)
  }
}
```

这个例子只管理一个会话的一次运行。多个会话共用一个导出器时，要等它们全部结束后再 flush 和关闭。

## 开发检查

`createAgent({ checkDeterminism })` 打开两项开销很小的检查。`NODE_ENV` 为 `development` 或 `test` 时默认开启，否则默认关闭。

1. **冻结已提交的状态。** 其中的普通对象和数组被逐层冻结，所以写入 `ctx.state`、`ctx.own` 或 `record` 的输入会在那一行抛出 `TypeError`。`chat.state` 和 `r.state` 也被冻结，修改前先复制。类实例、Map、Set 不处理。
2. **每个 `state.reduce` 执行两次**，输入相同。两次结果不同时，该插件收到一次 `DeterminismWarning`，保留第一次的结果。状态只写入一次，所以正确的计数器仍然只加 1。

它们能发现常见错误，但不能证明插件是纯的。两次 `Date.now()` 可能返回同一个值；在 reducer 里发请求，两次回答相同就查不出来（而且请求发了两次）。`record` 不重复执行，因为那会把 `next` 后面的一切再跑一遍。

## 规则

1. `record` 和 `state.reduce` **同步且纯**。IO 放在 `decide`、`input`、`request`、`toolCalls` 或 `toolCall` 里，并把 `ctx.signal` 传下去。
2. 在流式钩子里用 **`return yield* next(...)`** 消费流，或者用辅助函数，保证取消能传下去、内层事件和返回值都不会丢。
3. 重试可能解决的失败，工具**抛出**；预期内的失败**返回 `toolError(call, reason)`**（见[上文](#错误与重试)）。
4. 在 `decide` 里返回 `rewriteHistory(messages)` 替换历史，返回 `stop(state)` 以最后一条助手消息结束运行。
5. 不要原地修改状态，要返回新值。
6. 插件之间不互相导入。它们共享的是每个插件都能读到的东西：`Turn`、消息，以及事件名和它的形状。

## 插件发出的事件

插件在任何流式钩子里 yield 一个事件，并用声明合并登记它的类型，命名为 `<插件名>:<事件>`：

```ts
declare module '@gaoxiang.ai/llm' {
  interface Events {
    'compaction:start': { tokens: number }
    'compaction:end': { before: number; after: number }
  }
}

definePlugin({
  name: 'compaction',
  async *decide(state, next, { complete }) {
    if (count(state.messages) < limit) return yield* next(state)
    yield { type: 'compaction:start', tokens: count(state.messages) }
    const reply = yield* complete({ systemPrompt: SUMMARIZE, messages: [user(transcript(state.messages))] })
    const messages = [user(textOf(reply))]
    yield { type: 'compaction:end', before: count(state.messages), after: count(messages) }
    return rewriteHistory(messages)
  },
})
```

读的人按 `e.type === 'compaction:start'` 判别，不需要导入这个插件；另一个插件要读，就自己声明同样的形状。事件出现在它被 yield 的位置：在 `next` 之前 yield，就排在 `next` 的事件之前。事件只陈述发生过的事。要根据别的插件做了什么来改变行为，请在 `state.reduce` 里读 `Turn`（压缩就是一个 `rewrite` turn，不管是谁做的），因为事件既不保存也不重放。

## 该用哪个钩子

| 我想……                            | 用                                               | 例子                                                                                   |
| --------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| 修改工具参数或结果                | `toolCall: before(...)` / `toolCall: after(...)` | [`truncate-tool-results.ts`](../../apps/examples/src/plugins/truncate-tool-results.ts) |
| 审批、拦截工具调用                | `toolCall: intercept(...)`                       | 返回 `toolError(call, reason)` 即拦截                                                  |
| 重试工具                          | `toolCall`                                       | [错误与重试](#错误与重试)                                                              |
| 一个回合的工具调用逐个执行        | `toolCalls`                                      | [`sequential-tools.ts`](../../apps/examples/src/plugins/sequential-tools.ts)           |
| 一次审批一个回合的全部工具调用    | `toolCalls: intercept(...)`                      | 拒绝时为 `callsOf(message)` 的每个调用返回一个 `toolError`                             |
| 工具超时                          | 在工具的 `run` 里                                | `AbortSignal.any([signal, AbortSignal.timeout(ms)])`                                   |
| 换模型、改 temperature / thinking | `request: before(...)`                           | [`hooks.ts`](../../apps/examples/src/hooks.ts) 的 `lowTemperature`                     |
| 模型出错时换兜底模型              | `request`                                        | [`hooks.ts`](../../apps/examples/src/hooks.ts) 的 `fallbackTo`                         |
| 改写流式文字（只影响显示）        | `request: mapEvents(...)`                        | 输出时遮盖密钥                                                                         |
| 给请求加检索结果、只发最近 N 条   | `request: before(...)`，跳过带 `ctx.by` 的调用   | [`hooks.ts`](../../apps/examples/src/hooks.ts) 的 `retrieval`                          |
| 任务没完成就自动继续、定时提醒    | `input`                                          | [`keep-going.ts`](../../apps/examples/src/plugins/keep-going.ts)                       |
| 写摘要并替换历史                  | `decide` + `ctx.complete` + `rewriteHistory`     | [`compaction.ts`](../../apps/examples/src/plugins/compaction.ts)                       |
| 预算、步数上限                    | `decide: intercept(...)` + `stop`                | [`budget.ts`](../../apps/examples/src/plugins/budget.ts)                               |
| 截断历史（不调用模型）            | `record`                                         | [`apps/demo`](../../apps/demo/src/main.ts) 的 `keepLast`                               |
| 保存自己的计数                    | `state: { init, reduce }`，用 `ctx.own` 读取     | [`keep-going.ts`](../../apps/examples/src/plugins/keep-going.ts)                       |
| 统计耗时、token、费用             | 不写插件：`r.summary`、`r.turns`、`usageOf`      | [`metrics.ts`](../../apps/examples/src/metrics.ts)                                     |
| 记录日志、追踪、计数              | `observe`                                        | [`plugins/otel`](../../plugins/otel)、[`plugins/jsonl`](../../plugins/jsonl)           |
| 显示一个耗时步骤正在做什么        | 在 `decide`、`request` 或 `toolCall` 里 `yield`  | [插件发出的事件](#插件发出的事件)                                                      |

`budget` 用 `usageOf(state)` 计数，它只看得到仍在历史里的主模型消息，所以不是严格的费用上限：`ctx.complete` 的调用和被压缩掉的消息都不算在内（见[会话与运行](sessions-and-runs.md#统计不需要插件)）。

[`apps/examples/src/plugins`](../../apps/examples/src/plugins) 里的插件可以直接复制过去改；[`plugins/`](../../plugins) 下的包可以直接安装：`otel`、`jsonl`、`throttle-updates`；每个示例的详细说明见 [示例 README](../../apps/examples/README.md)。

## 工具

```ts
import { tool, Type } from '@gaoxiang.ai/llm'

const calc = tool({
  name: 'calc',
  description: 'Evaluate an arithmetic expression.',
  parameters: Type.Object({ expr: Type.String() }),
  // expr 的类型 string 从 schema 推断
  run: ({ expr }, signal) => evaluate(expr),
})
```

`run` 之前会先按 schema 校验参数。同一回合的多个工具调用并行执行，它们的事件交错出现，结果保持调用顺序。`run` 写成异步生成器就能报告进度，见[工具的中间更新](sessions-and-runs.md#事件)。
