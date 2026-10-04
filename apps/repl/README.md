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
▸  read(path: "package.json")                              ┃
✓  read  { "name": … }                                     │
──────────────────────────────────────────────────────────
◐ Writing 2s · ask: before every file read and change · …     ← 状态行：在做什么、等了几秒、模式、待送达的插话
› Steer the reply: it reads this after the step in progress   ← 输入行
```

- 打开时占满当前终端窗口（终端的 alternate screen，和 vim、htop 一样），顶栏和底栏固定，只有中间的对话滚动。
- 鼠标滚轮或 PgUp/PgDn 滚动对话；往回翻的时候状态行会提示下面还有多少行，按 Enter 发消息会回到最底部。
- 鼠标被 REPL 用来滚动，所以在窗口里用鼠标选字要按住修饰键（iTerm2 是 Option，VS Code 要开 `terminal.integrated.macOptionClickForcesSelection`）。退出时整段对话会打印回普通终端，在那里可以照常选择、复制、往回翻。

## 对话

一个会话接一个 `send`，读 `Run` 本身（`for await (const e of r)`）：`text` 边生成边写出，`tool_call` 显示工具名和参数，`tool_end` 显示工具结果。

- 回答进行中也能打字。按 Enter 就是插话：`chat.send(text, { when: 'step' })`，消息并进同一个 `Run`，等当前这一步（模型这一轮，或正在跑的工具）结束后送到模型。送达时（`step_end` 里的 `input` 轮）才显示在对话里，标着 `· steer`；还没送达的数量显示在状态行。
- 回答中按 Ctrl+C 调用 `r.abort()`，只停止这一次回答；会话回到发送前的状态，这次回答里发过的消息（包括插话）填回输入框，可以改了再发。出错时也一样。
- `/think <档位>` 切换思考档位，回答进行中也可以：`chat.use(agent.with({ thinking }))`，下一次模型调用生效。思考过程（`thinking`）灰色显示。
- 输入框有字时 Ctrl+C 清空，空着时 Ctrl+C 或输入 `/exit` 退出。粘贴的多行文字会合成一行，不会提前发送。

## 文件和提问

- 装了 [`@ji.dev/plugin-files`](../../plugins/files/src/index.ts) 的 `read` 和 `edit`。回答被 Ctrl+C 停止时会话回滚，但已经写入磁盘的修改不会撤销，提示里会列出改过的文件；模型下次修改那个文件前会被要求重新读取。
- 每次读文件前、每次改文件写入前（先显示 diff）都要等你确认。Shift+Tab 在“逐个确认”和“自动同意”之间切换，状态行和确认问题的标题都会显示当前模式；在确认问题上切换只影响之后的调用，这个问题仍要你来回答。确认问题里还有两个快捷选项：“Yes, and approve the rest inside the workspace”（同意并切到自动），以及读文件时的“Yes, and stop asking about reads inside the workspace”。
- 启动目录之外的文件也能读写，但无论哪种模式都要先确认，问题标题末尾会用黄色标出 `(outside the workspace)`，光标默认停在 No。自动同意只覆盖启动目录。
- 模型可以用 `ask_user` 工具自己提问、自己给选项：一个问题是单选或多选，几个问题就是 Tabs（←/→ 切换，最后一个 Tab 汇总提交），每个问题都能选 Other 自己输入。任何问题按 Esc 都只是关掉这一个（审批算 No），回复继续；Ctrl+C 停掉整个回复。问题打开时按键归问题，输入行变灰，打过的字留着。
- 这些都来自一个插件：`choices({ answer, approve: [fileCalls] })`。它带上 `ask_user` 工具，在 `toolCall` 层对 `approve` 里的 preview 提出的调用 `yield` 一个 `ask:choices` 事件，并在 `toolCalls` 层用 `answer` 回答所有问题（RFC-0007 §5）；`@ji.dev/plugin-choices/terminal` 的 `terminal()` 就是一个在终端里画问题的 `answer`。模式决定的是“问不问”（`fileCalls` 在自动模式下对启动目录内的调用返回 `undefined`），不是“怎么答”。换成 `approve: [named('bash')]` 或 `[everyCall]`，就能审批任何工具。

## 代码

| 文件                           | 做什么                                                                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [`repl.ts`](src/repl.ts)       | 入口：agent、插件、按键、两条栏的内容                                                                                                    |
| [`screen.ts`](src/screen.ts)   | 终端的三块布局。程序写到 stdout 的内容进一个 [`@xterm/headless`](https://github.com/xtermjs/xterm.js) 虚拟终端，再按滚动位置画出其中一屏 |
| [`cells.ts`](src/cells.ts)     | 把虚拟终端的一行连同颜色、粗体等还原成 ANSI 文本                                                                                         |
| [`editing.ts`](src/editing.ts) | 输入行的编辑状态，纯函数 `edit(state, key)`，和绘制分开                                                                                  |

对程序来说，stdout 就是中间那块对话区：`write` 写进虚拟终端，`columns` 和 `rows` 是对话区的大小。所以 [clack](https://bomb.sh/docs/clack/basics/getting-started/) 的输出和确认问题不用改，照常在里面换行、重画。stdin 先经过 `Screen`，滚轮事件被取走，剩下的按键从 `screen.keys` 给 REPL 和确认问题。

需要在真正的终端里运行。
