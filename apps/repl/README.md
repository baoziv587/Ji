# REPL：在终端里和 agent 聊天

一个占满当前终端窗口的聊天 REPL，建在 `@ji.dev/llm` 上：DeepSeek 模型、带审批的文件读写、模型自己提问，回答进行中可以随时插话。

```bash
DEEPSEEK_API_KEY=sk-... pnpm repl
DEEPSEEK_MODEL=deepseek-v4-pro ...   # 换模型，默认 deepseek-v4-flash
DEEPSEEK_THINKING=off ...            # 关闭思考，默认 high；可用档位 off / high / xhigh
```

## 画面

```
ji · deepseek/deepseek-v4-flash · thinking high · ~/project     ← 顶栏：模型、思考档位、工作目录
──────────────────────────────────────────────────────────
●  read it                                                 ┃  ← 对话：只有这一块滚动，右边是滚动条
◌  Thought for 4s · 1.2k chars                             ┃
✓  read(path: "package.json")                              │
──── in 48.2k · out 3.1k · cache 86% · 41 tok/s · $0.0123 ─   ← 整个会话的用量
◐ Writing 2s · ask: before every file read and change · …     ← 状态行：在做什么、等了几秒、模式、待送达的插话
› Steer the reply: it reads this after the step in progress   ← 输入行
```

- 打开时占满当前终端窗口（终端的 alternate screen，和 vim、htop 一样），顶栏和底栏固定，只有中间的对话滚动。
- 鼠标滚轮或 PgUp/PgDn 滚动对话；往回翻的时候状态行会提示下面还有多少行，按 Enter 发消息会回到最底部。
- 对话默认是简洁视图：思考只留一行（用了几秒、多少字），工具调用一次一行，出错时带上错误信息。Ctrl+O 切到详细视图，看完整的思考和每次调用的参数、结果，再按一次切回来；状态行开头的 `details · Ctrl+O hides` 表示正在看详细视图。两个视图的行对不上，所以切换后回到底部。思考进行中，状态行显示已经写了多少字和最后几个词。
- 对话在等什么，就显示在对话的末尾，原地更新，等完就收起：回答里的表格要等它写完才画，等的时候那里是一行 `◐ table · 14 rows`；工具跑了半秒以上、或者有了输出，就显示一行 `◐  bash(command: "pnpm test")  12s · 340 lines`，最近有输出的那个调用下面带着最后 5 行输出。成功后这几行收成一行 `✓`；失败时简洁视图在 `✗` 下面留着最后 5 行，原因多半在那里。确认问题打开时这几行先让开，答完再回到问题下面。
- 状态行上面那条线的右端是整个会话的用量，每次模型调用结束时更新：发给模型的 token（含命中缓存的部分）、输出 token、缓存命中率、平均输出速度（不算等第一个 token 的时间）、花费。插件的模型调用、出错和被停掉的回答已经花掉的都算在内。宽度不够时依次隐藏花费、速度、命中率。
- 鼠标被 REPL 用来滚动，所以在窗口里用鼠标选字要按住修饰键（iTerm2 是 Option，VS Code 要开 `terminal.integrated.macOptionClickForcesSelection`）。退出时整段对话（当前视图）会打印回普通终端，在那里可以照常选择、复制、往回翻。

## 对话

一个会话接一个 `send`，读 `Run` 本身（`for await (const e of r)`）：`text` 边生成边写出，`tool_call` 显示工具名和参数，`tool_end` 显示工具结果。每次调用在简洁视图里只占一行，参数和错误按显示宽度截断；简洁视图里结果不止一行时，在调用后面标出行数（`1.2k lines`），也就是模型接下来要读多少。Ctrl+O 的详细视图里参数一个一行；结果不止一行时显示前 30 行，bash 显示最后 30 行（成败写在末尾），读到的文件还会编号并上色。

- 回答进行中也能打字。按 Enter 就是插话：`chat.send(text, { when: 'step' })`，消息并进同一个 `Run`，等当前这一步（模型这一轮，或正在跑的工具）结束后送到模型。送达时（`step_end` 里的 `input` 轮）才显示在对话里，标着 `· steer`；还没送达的数量显示在状态行。
- 回答中按 Ctrl+C 调用 `r.abort()`，只停止这一次回答；会话回到发送前的状态，这次回答里发过的消息（包括插话）填回输入框，可以改了再发。出错时也一样。
- `/think <档位>` 切换思考档位，回答进行中也可以：`chat.use(agent.with({ thinking }))`，下一次模型调用生效。思考过程（`thinking`）灰色显示。
- 输入框有字时 Ctrl+C 清空，空着时 Ctrl+C 或输入 `/exit` 退出。粘贴的多行文字会合成一行，不会提前发送。

## 文件和提问

- 装了 [`@ji.dev/plugin-files`](../../plugins/files/src/index.ts) 的 `read` 和 `edit`。回答被 Ctrl+C 停止时会话回滚，但已经写入磁盘的修改不会撤销，提示里会列出改过的文件；模型下次修改那个文件前会被要求重新读取。
- 每次读文件前、每次改文件写入前（先显示 diff）都要等你确认。Shift+Tab 在“逐个确认”和“自动同意”之间切换，状态行和确认问题的标题都会显示当前模式；在确认问题上切换只影响之后的调用，这个问题仍要你来回答。确认问题里还有两个快捷选项：“Yes, and approve the rest inside the workspace”（同意并切到自动），以及读文件时的“Yes, and stop asking about reads inside the workspace”。
- 启动目录之外的文件也能读写，但无论哪种模式都要先确认，问题标题末尾会用黄色标出 `(outside the workspace)`，光标默认停在 No。自动同意只覆盖启动目录。
- 确认一次也可以不再问：bash 的确认里有“Yes, and allow every command from now on”，读启动目录外的文件时有“Yes, and allow reads in ~/某目录/ from now on”（这个目录和它的子目录）。放行了什么会用黄色写在状态行；Shift+Tab 切回逐个确认时全部收回。
- 模型可以用 `ask_user` 工具自己提问、自己给选项：一个问题是单选或多选，几个问题就是 Tabs（←/→ 切换，最后一个 Tab 汇总提交），每个问题都能选 Other 自己输入。任何问题按 Esc 都只是关掉这一个（审批算 No），回复继续；Ctrl+C 停掉整个回复。问题打开时按键归问题，输入行变灰，打过的字留着。
- 这些都来自一个插件：`choices({ answer: answering.answer, approve: permissions.approve })`。它带上 `ask_user` 工具，在 `toolCall` 层对 `approve` 里的 preview 提出的调用 `yield` 一个 `ask:choices` 事件，并在 `toolCalls` 层用 `answer` 回答所有问题（RFC-0007 §5）；`@ji.dev/plugin-choices/terminal` 的 `terminal()` 就是一个在终端里画问题的 `answer`。模式决定的是“问不问”（[`Permissions`](src/plugins/permissions.ts) 的 preview 在自动模式下对启动目录内的文件调用返回 `undefined`），不是“怎么答”。换成 `approve: [named('bash')]` 或 `[everyCall]`，就能审批任何工具。

## 代码

`src/` 下只有入口 [`repl.ts`](src/repl.ts)：把下面三块组装起来，放着按键表，负责启动和退出。其余代码按层分目录，层里再按领域分；`agent/` 和 `plugins/` 不知道终端的存在。

| 文件                                            | 做什么                                                                                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **`agent/`**                                    | **模型和会话**                                                                                                                           |
| [`agent.ts`](src/agent/agent.ts)                | 创建 agent：模型、思考档位、system prompt、装哪些插件                                                                                    |
| [`conversation.ts`](src/agent/conversation.ts)  | 会话：发送、插话；回答没完成时回到发送前，交回发过的消息                                                                                 |
| **`plugins/`**                                  | **REPL 自己的**                                                                                                                          |
| [`tools.ts`](src/plugins/tools.ts)              | 两个小工具 calc 和 now                                                                                                                   |
| [`permissions.ts`](src/plugins/permissions.ts)  | 哪些调用要等确认：ask/auto 模式、确认里的快捷选项、一次批准后放行的命令和目录。只管策略，不管怎么显示                                    |
| **`ui/screen/`**                                | **整个画面**                                                                                                                             |
| [`screen.ts`](src/ui/screen/screen.ts)          | 终端的三块布局。程序写到 stdout 的内容进一个 [`@xterm/headless`](https://github.com/xtermjs/xterm.js) 虚拟终端，再按滚动位置画出其中一屏 |
| [`cells.ts`](src/ui/screen/cells.ts)            | 把虚拟终端的一行连同颜色、粗体等还原成 ANSI 文本                                                                                         |
| [`bars.ts`](src/ui/screen/bars.ts)              | 上下两条栏的内容：顶栏、用量线、状态行、输入行。纯函数                                                                                   |
| [`status.ts`](src/ui/screen/status.ts)          | 底栏里转着的状态：在做什么、做了多久                                                                                                     |
| [`live.ts`](src/ui/screen/live.ts)              | 对话末尾那几行活的内容：在等的表格、正在跑的工具。别的输出写在它们上面，问题打开时让开                                                   |
| [`usage.ts`](src/ui/screen/usage.ts)            | 会话用量的累计                                                                                                                           |
| [`editing.ts`](src/ui/screen/editing.ts)        | 输入行的编辑状态，纯函数 `edit(state, key)`，和绘制分开                                                                                  |
| **`ui/reply/`**                                 | **一条回答**                                                                                                                             |
| [`render.ts`](src/ui/reply/render.ts)           | 把 run 的事件画成两个视图里的行，和状态栏里的状态                                                                                        |
| [`gutter.ts`](src/ui/reply/gutter.ts)           | 把流式回复写在 clack 的竖线右边：回答交给 `Markdown`，思考过程原样暗色显示                                                               |
| **`ui/markdown/`**                              | **回答里的 Markdown，边流边画**                                                                                                          |
| [`markdown.ts`](src/ui/markdown/markdown.ts)    | 入口：只判断一行归谁处理（文字行、代码块、表格），每种元素自己处理自己的行                                                               |
| [`line.ts`](src/ui/markdown/line.ts)            | 标题、列表（嵌套、任务）、引用、分隔线：行首一看清是什么就定下前缀，其余逐词输出                                                         |
| [`inline.ts`](src/ui/markdown/inline.ts)        | 粗体、斜体、删除线、行内代码、链接：标记闭合后才带样式输出，没闭合的原样输出                                                             |
| [`code.ts`](src/ui/markdown/code.ts)            | 代码块，逐行上色                                                                                                                         |
| [`table.ts`](src/ui/markdown/table.ts)          | 表格：等它结束再按终端宽度画成网格，太宽时收窄列、在格子里折行                                                                           |
| [`flow.ts`](src/ui/markdown/flow.ts)            | 按词折行，每行前面带上列表或引用的前缀                                                                                                   |
| [`calls.ts`](src/ui/reply/calls.ts)             | 工具调用和结果在两个视图里的样子，每行按显示宽度截断；正在跑的工具那一行和它最后几行输出                                                 |
| **`ui/questions/`**                             | **确认和提问**                                                                                                                           |
| [`answering.ts`](src/ui/questions/answering.ts) | 把问题交给人：确认的标题、模式、快捷选项，切换模式时重画问题                                                                             |
| [`diff.ts`](src/ui/questions/diff.ts)           | 确认里的 diff：按文件语言上色，改动的部分用更深的底色                                                                                    |
| **`ui/paint/`**                                 | **大家共用的画法**                                                                                                                       |
| [`text.ts`](src/ui/paint/text.ts)               | 按显示宽度截断、取尾、折行，按键提示和数字的写法                                                                                         |
| [`highlight.ts`](src/ui/paint/highlight.ts)     | 用 [shiki](https://shiki.style) 给代码上色，逐行带着语法状态，可以给一行的一部分加底色                                                   |

简洁和详细两个视图各是一个虚拟终端：stdout 同时写进两边，`screen.brief` 和 `screen.full` 只写进其中一边（clack `log` 的 `output` 选项），确认问题在两边一样地重画，所以切换视图不需要重放对话。

对程序来说，stdout 就是中间那块对话区：`write` 写进虚拟终端，`columns` 和 `rows` 是对话区的大小。所以 [clack](https://bomb.sh/docs/clack/basics/getting-started/) 的输出和确认问题不用改，照常在里面换行、重画。stdin 先经过 `Screen`，滚轮事件被取走，剩下的按键从 `screen.keys` 给 REPL 和确认问题。

需要在真正的终端里运行。
