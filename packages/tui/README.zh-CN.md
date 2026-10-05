# @ji.dev/tui

[English](README.md) · **简体中文**

全屏终端对话的各个部件，它们都不关心对话里说的是什么。[`apps/coding-agent`](../../apps/coding-agent) 建在它上面：app 决定栏里写什么、回答长什么样，怎么画交给这里。

```ts
import { createRailRows, Markdown, Screen, widthBesideRail } from '@ji.dev/tui'

const screen = new Screen(columns => ({
  top: ['', ' my app', '─'.repeat(columns - 1)],
  bottom: ['', ' › '],
}))
screen.start()
const markdown = new Markdown(createRailRows(process.stdout, '│'), widthBesideRail)
await markdown.write('# Hello\n\nSome **bold** text\n')
markdown.end()
```

| 文件                                      | 做什么                                                                                                                                                                                                                 |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`screen/`**                             | **整个画面**                                                                                                                                                                                                           |
| [`screen.ts`](src/screen/screen.ts)       | 备用屏的三块布局：上下是调用方给的栏，中间是写到 stdout 的全部内容，存在 [`@xterm/headless`](https://github.com/xtermjs/xterm.js) 虚拟终端里，按滚动位置画出一屏。滚轮和 PgUp/PgDn 滚动；stop 或进程退出时把终端还回去 |
| [`cells.ts`](src/screen/cells.ts)         | 把虚拟终端的一行连同颜色、粗体等还原成 ANSI 文本                                                                                                                                                                       |
| [`live.ts`](src/screen/live.ts)           | 内容末尾原地刷新的几行；别的输出写在它们上面，有提示框时让开                                                                                                                                                           |
| [`status.ts`](src/status.ts)              | 转圈并计秒的状态                                                                                                                                                                                                       |
| [`editing.ts`](src/editing.ts)            | 输入行：纯函数 `applyKey(state, key)`，以及按光标位置横向滚动绘制的 `renderInputLine`                                                                                                                                  |
| **`markdown/`**                           | **边流边画的 Markdown**                                                                                                                                                                                                |
| [`markdown.ts`](src/markdown/markdown.ts) | 入口：只判断一行归谁处理（文字行、代码块、表格），每种元素自己处理自己的行                                                                                                                                             |
| [`line.ts`](src/markdown/line.ts)         | 标题、列表（嵌套、任务）、引用、分隔线：行首一看清是什么就定下前缀，其余逐词输出                                                                                                                                       |
| [`inline.ts`](src/markdown/inline.ts)     | 粗体、斜体、删除线、行内代码、链接：标记闭合后才带样式输出，没闭合的原样输出                                                                                                                                           |
| [`code.ts`](src/markdown/code.ts)         | 代码块，逐行上色                                                                                                                                                                                                       |
| [`table.ts`](src/markdown/table.ts)       | 表格：等它结束再按宽度画成网格，太宽时收窄列、在格子里折行                                                                                                                                                             |
| [`flow.ts`](src/markdown/flow.ts)         | 按词折行，每行前面带上列表或引用的前缀                                                                                                                                                                                 |
| [`plain.ts`](src/markdown/plain.ts)       | 纯文本也这样折行，用给定的样式                                                                                                                                                                                         |
| **画法**                                  |                                                                                                                                                                                                                        |
| [`rail.ts`](src/rail.ts)                  | clack 的竖线，以及写在竖线右边的行                                                                                                                                                                                     |
| [`highlight.ts`](src/highlight.ts)        | 用 [shiki](https://shiki.style) 给代码上色，逐行带着语法状态，可以给一行的一部分加底色                                                                                                                                 |
| [`diff.ts`](src/diff.ts)                  | 按文件语言上色的 diff，改动的部分用更深的底色                                                                                                                                                                          |
| [`output.ts`](src/output.ts)              | 正在运行的命令的输出尾部：多少行，以及最后几行有内容的                                                                                                                                                                 |
| [`layout.ts`](src/layout.ts)              | 把一行塞进给定宽度：取第一个放得下的版本、从左边缩短路径、带标签的分隔线；按键帮助                                                                                                                                     |
| [`text.ts`](src/text.ts)                  | 按显示宽度截断、取尾、折行；暗色文字、按键提示和数字的写法                                                                                                                                                             |

对程序来说，stdout 就是两条栏中间的内容区：写进一个 `columns` 和 `rows` 等于内容区大小的虚拟终端，所以 [clack](https://bomb.sh/docs/clack/basics/getting-started/) 的输出和提示不用改。简洁、详细两个视图各是一个虚拟终端，切换不用重放。Screen 会接管进程的 stdout，所以同一时间只能有一个。
