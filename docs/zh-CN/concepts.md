# 核心概念

[English](../concepts.md) · **简体中文**

这一篇讲 JI 背后的模型。只想直接用的话，先看 [README](../../README.zh-CN.md) 和 [会话与运行](sessions-and-runs.md)。

## 一步，三个函数

内核把任何 agent 描述成三个函数：

```
π  policy  : S → D* · (A + R)   决策：先流出若干增量 D，最后给出动作 A 或结果 R
ε  env     : A → O              执行：产生副作用
δ  update  : S × A × O → S      记录：得到下一个状态（同步、纯）
```

`unfold` 反复执行「决策 → 执行 → 记录」，直到 policy 给出结果为止，输出是一个惰性的事件流。`extend` 给这三个函数中的任意一个套上中间件，这是扩展 agent 的唯一方式。

## 三层结构

| 层 | 职责 | 类型 |
| --- | --- | --- |
| `@gaoxiang.ai/kernel` | `(π, ε, δ)` 代数、`unfold`、`extend`。与 LLM 和 IO 无关 | 泛型 `S, A, O, R, D` |
| `@gaoxiang.ai/llm` agent | 用 pi-ai 实现 `(π, ε, δ)`，把插件编译成内核中间件 | `S = AgentState`、`O = ToolResultMessage[]`、`D = AssistantMessageEvent` |
| `@gaoxiang.ai/llm` session | 驱动 `unfold`，排队外部消息，遇到中断时把一次运行分段 | `Session`、`Run` |

## 一步里发生了什么

**步边界**是两步之间的时刻：模型没有在输出，工具也没有在执行。每个步边界上：

```
policy ─┬─ ① input    有要插入的消息？        有 → 记录它们，这一步结束
        │             没有，且 agent 空闲？   → 运行结束
        ├─ ② context  这次发给模型的消息（不改历史）
        └─ ③ request  调用模型，流出增量
env ───── 这一回合的工具调用，并行执行 → tool（每次调用）
update ── 把这一步写入历史 → 各插件的 state.reduce
```

agent **空闲**是指：历史为空，或者最后一条是没有工具调用的助手消息。

每一步恰好产生一条 **Turn**，`update`、`state.reduce`、`Run.turns` 看到的是同一个序列：

| `turn.kind` | 来源 | 对历史的影响 |
| --- | --- | --- |
| `model` | 模型回复及其工具结果；最终回答的 `results: []` | 追加消息和结果 |
| `input` | 在步边界插入的外部消息（用户、steer、follow-up、插件） | 追加消息 |
| `rewrite` | `policy` 中间件返回的 `rewriteHistory(messages)` | 替换整个历史 |

最终回答在运行结束前就已经写入，所以它同样经过 `update`。

## 不变量

设计依赖下面几条规则。违反其中任何一条都不会直接报错，但会引入隐蔽的问题。

1. **`update` 和 `state.reduce` 同步且纯**：不读时钟，不发请求。所以保存的状态能被精确重现。
2. **IO 放在 `policy`、`request`、`env` 或 `tool` 里**。例如压缩插件在 `policy` 里写摘要，再通过 `rewriteHistory` 把替换交给 `update`。
3. **工具失败是结果，不是异常**：返回 `toolError(call, reason)`。就算抛出了异常，也会被转成错误结果交给模型。
4. **取消通过 `yield*` 传递**：流式中间件里写 `return yield* next(...)`，取消才能传到 HTTP 请求，返回值也不会丢。
5. **被中断的一步不会写入**：状态只在一步完成后才前进。
6. **插件状态存在 `AgentState` 里**：位于 `state.plugins[name]`，跟消息一起保存和恢复。

## 继续阅读

- [编写插件](plugins.md)：每个钩子在上面这一步中的位置
- [内核 API](kernel.md)：直接使用这套代数
