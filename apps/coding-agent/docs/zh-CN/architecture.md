# 代码结构

[English](../architecture.md) · **简体中文**

建在 [`@ji.dev/llm`](../../../../packages/llm) 上，用 [`@ji.dev/tui`](../../../../packages/tui) 绘制，工具来自 [`plugin-files`](../../../../plugins/files)、[`plugin-shell`](../../../../plugins/shell) 和 [`plugin-choices`](../../../../plugins/choices)。`src/` 下只有入口 [`main.ts`](../../src/main.ts)，其余按层分目录；`agent/` 和 `plugins/` 不知道终端的存在；`ui/` 只决定对话里显示什么，怎么画交给 `@ji.dev/tui`。

| 文件                                                 | 做什么                                                                                                |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **`agent/`**                                         | **模型和会话**                                                                                        |
| [`agent.ts`](../../src/agent/agent.ts)               | 创建 agent：模型、思考档位、system prompt、装哪些插件                                                 |
| [`conversation.ts`](../../src/agent/conversation.ts) | 会话：发送、插话；回答没完成时回到发送前，交回发过的消息                                              |
| **`plugins/`**                                       | **coding agent 自己的**                                                                               |
| [`tools.ts`](../../src/plugins/tools.ts)             | 两个小工具 calc 和 now                                                                                |
| [`permissions.ts`](../../src/plugins/permissions.ts) | 哪些调用要等确认：ask/auto 模式、确认里的快捷选项、一次批准后放行的命令和目录。只管策略，不管怎么显示 |
| **`ui/`**                                            | **对话里显示什么**                                                                                    |
| [`bars.ts`](../../src/ui/bars.ts)                    | 上下两条栏说什么：模型和思考档位、用量、状态、模式、当下有用的按键。纯函数                            |
| [`usage.ts`](../../src/ui/usage.ts)                  | 会话用量的累计                                                                                        |
| [`answering.ts`](../../src/ui/answering.ts)          | 把问题交给人：确认的标题、模式、快捷选项，切换模式时重画问题                                          |
| [`reply/render.ts`](../../src/ui/reply/render.ts)    | 把 run 的事件画成两个视图里的行，和状态栏里的状态                                                     |
| [`reply/gutter.ts`](../../src/ui/reply/gutter.ts)    | 回答的思考和正文写在竖线右边：正文按 Markdown，思考暗色，结束后在简洁视图里留一行                     |
| [`reply/calls.ts`](../../src/ui/reply/calls.ts)      | 工具调用和结果在两个视图里的样子；正在写、正在跑的调用那一行和它最后几行输出                          |

画面、Markdown、上色、输入行、按显示宽度截断这些都在 [`@ji.dev/tui`](../../../../packages/tui) 里，各部分见它的 README。
