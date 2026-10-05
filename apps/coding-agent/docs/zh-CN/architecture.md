# 代码结构

[English](../architecture.md) · **简体中文**

建在 [`@ji.dev/llm`](../../../../packages/llm) 上，工具来自 [`plugin-files`](../../../../plugins/files)、[`plugin-shell`](../../../../plugins/shell) 和 [`plugin-choices`](../../../../plugins/choices)。`src/` 下只有入口 [`main.ts`](../../src/main.ts)，其余按层分目录；`agent/` 和 `plugins/` 不知道终端的存在。

| 文件                                                  | 做什么                                                                                                                                   |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **`agent/`**                                          | **模型和会话**                                                                                                                           |
| [`agent.ts`](../../src/agent/agent.ts)                | 创建 agent：模型、思考档位、system prompt、装哪些插件                                                                                    |
| [`conversation.ts`](../../src/agent/conversation.ts)  | 会话：发送、插话；回答没完成时回到发送前，交回发过的消息                                                                                 |
| **`plugins/`**                                        | **coding agent 自己的**                                                                                                                  |
| [`tools.ts`](../../src/plugins/tools.ts)              | 两个小工具 calc 和 now                                                                                                                   |
| [`permissions.ts`](../../src/plugins/permissions.ts)  | 哪些调用要等确认：ask/auto 模式、确认里的快捷选项、一次批准后放行的命令和目录。只管策略，不管怎么显示                                    |
| **`ui/screen/`**                                      | **整个画面**                                                                                                                             |
| [`screen.ts`](../../src/ui/screen/screen.ts)          | 终端的三块布局。程序写到 stdout 的内容进一个 [`@xterm/headless`](https://github.com/xtermjs/xterm.js) 虚拟终端，再按滚动位置画出其中一屏 |
| [`cells.ts`](../../src/ui/screen/cells.ts)            | 把虚拟终端的一行连同颜色、粗体等还原成 ANSI 文本                                                                                         |
| [`bars.ts`](../../src/ui/screen/bars.ts)              | 上下两条栏的内容：顶栏、用量线、状态行、输入行。纯函数                                                                                   |
| [`status.ts`](../../src/ui/screen/status.ts)          | 底栏里转着的状态：在做什么、做了多久                                                                                                     |
| [`live.ts`](../../src/ui/screen/live.ts)              | 对话末尾那几行活的内容：在等的表格、正在写和正在跑的调用。别的输出写在它们上面，问题打开时让开                                           |
| [`usage.ts`](../../src/ui/screen/usage.ts)            | 会话用量的累计                                                                                                                           |
| [`editing.ts`](../../src/ui/screen/editing.ts)        | 输入行的编辑状态，纯函数 `edit(state, key)`，和绘制分开                                                                                  |
| **`ui/reply/`**                                       | **一条回答**                                                                                                                             |
| [`render.ts`](../../src/ui/reply/render.ts)           | 把 run 的事件画成两个视图里的行，和状态栏里的状态                                                                                        |
| [`gutter.ts`](../../src/ui/reply/gutter.ts)           | 把流式回复写在 clack 的竖线右边：回答交给 `Markdown`，思考过程原样暗色显示                                                               |
| [`calls.ts`](../../src/ui/reply/calls.ts)             | 工具调用和结果在两个视图里的样子，每行按显示宽度截断；正在写、正在跑的调用那一行和它最后几行输出                                         |
| **`ui/markdown/`**                                    | **回答里的 Markdown，边流边画**                                                                                                          |
| [`markdown.ts`](../../src/ui/markdown/markdown.ts)    | 入口：只判断一行归谁处理（文字行、代码块、表格），每种元素自己处理自己的行                                                               |
| [`line.ts`](../../src/ui/markdown/line.ts)            | 标题、列表（嵌套、任务）、引用、分隔线：行首一看清是什么就定下前缀，其余逐词输出                                                         |
| [`inline.ts`](../../src/ui/markdown/inline.ts)        | 粗体、斜体、删除线、行内代码、链接：标记闭合后才带样式输出，没闭合的原样输出                                                             |
| [`code.ts`](../../src/ui/markdown/code.ts)            | 代码块，逐行上色                                                                                                                         |
| [`table.ts`](../../src/ui/markdown/table.ts)          | 表格：等它结束再按终端宽度画成网格，太宽时收窄列、在格子里折行                                                                           |
| [`flow.ts`](../../src/ui/markdown/flow.ts)            | 按词折行，每行前面带上列表或引用的前缀                                                                                                   |
| **`ui/questions/`**                                   | **确认和提问**                                                                                                                           |
| [`answering.ts`](../../src/ui/questions/answering.ts) | 把问题交给人：确认的标题、模式、快捷选项，切换模式时重画问题                                                                             |
| [`diff.ts`](../../src/ui/questions/diff.ts)           | 确认里的 diff：按文件语言上色，改动的部分用更深的底色                                                                                    |
| **`ui/paint/`**                                       | **大家共用的画法**                                                                                                                       |
| [`text.ts`](../../src/ui/paint/text.ts)               | 按显示宽度截断、取尾、折行，按键提示和数字的写法                                                                                         |
| [`highlight.ts`](../../src/ui/paint/highlight.ts)     | 用 [shiki](https://shiki.style) 给代码上色，逐行带着语法状态，可以给一行的一部分加底色                                                   |

stdout 就是中间那块对话区：写进 [`@xterm/headless`](https://github.com/xtermjs/xterm.js) 虚拟终端，所以 [clack](https://bomb.sh/docs/clack/basics/getting-started/) 的输出和问题不用改。简洁、详细两个视图各是一个虚拟终端，切换不用重放对话。
