---
name: shadcn-style-port
description: 把 shadcn/ui 的视觉细节（颜色令牌、间距、圆角、字重、hover/focus/disabled 状态）移植到非 React 的 UI 上，例如 Go 的 mygo 原生界面（apps/desktop）。用户说"按 shadcn 的样式"、"对齐 shadcn"、"学 shadcn 的颜色和间距"时使用。
---

# 把 shadcn/ui 的样式移植到非 React 的界面

shadcn/ui 是一份源码，不是一个组件库：每个组件是一段 Tailwind 类名。所以移植它不需要 React，只需要把组件源码里的类名逐个换算成目标 UI 的数值。

## 1. 先拿到官方源码，不要凭记忆

- **官方 skill 和 MCP 用不上。** shadcn 仓库里的 `skills/shadcn` 和 CLI 带的 `shadcn mcp`，作用都是往有 `components.json` 的 React + Tailwind 项目里安装 TSX。在 Go 项目里它们没法用，不必安装。
- **用 CLI 的 `view` 命令读源码。** 这个命令不需要项目里有 `components.json`：

  ```sh
  npx shadcn@latest view button badge input textarea select sidebar sonner tooltip > view.json   # new-york-v4 的组件源码
  npx shadcn@latest view @shadcn/theme-neutral > neutral.json                                       # 主题 cssVars，light 和 dark 两套
  npx shadcn@latest search @shadcn -q "chat"                                                         # 按关键词找组件
  ```

  输出是 JSON，组件源码在 `files[].content` 里。最有用的是 `cva` 的 `variants`、`size` 两段，还有 `focus-visible:`、`dark:`、`hover:` 这些前缀。

- **官方 skill 里的规则仍然值得遵守。** 比如：状态色只用语义令牌（`destructive`、`muted-foreground`），不手写颜色；状态标签用 Badge；聊天界面拆成消息气泡、Marker 和 InputGroup 来搭。
- 结果放在 scratchpad 里，不放进仓库。

## 2. 令牌：原值照抄，按名字查

- 把主题令牌原样抄进一个 `palette` 结构体，字段名和 shadcn 的变量名一一对应（`Background`、`Foreground`、`Primary`、`MutedForeground`、`Border`、`Input`、`Ring`、`Sidebar` 等）。light 和 dark 各写一份。
- OKLCH 用目标 UI 的 OKLCH 构造函数直接写（mygo 里是 `ui.Oklch(l, c, h)`），不要转成 hex，否则会损失精度，也没法和源码对照。
- 再把这份 palette 映射到 UI 框架自己的主题里，让内置控件也用上这些颜色。具体映射见 [references/tokens.md](references/tokens.md)。
- `Primary/90` 这样的写法，意思是在 `Primary` 的基础上乘以 0.9 的透明度。dark 主题的 `Border` 是 `oklch(1 0 0 / 10%)`，本身就是半透明白色。

数值表在 [references/tokens.md](references/tokens.md)，里面有 neutral 主题的全部令牌，以及各组件的尺寸和状态。

## 3. 怎么把 Tailwind 换算成像素

- 间距：1 个单位等于 4px。`h-9` 是 36px，`px-3` 是 12px，`gap-1.5` 是 6px。
- 圆角：`--radius` 是 0.625rem，也就是 10px。`rounded-md` 是 radius 减 2px，即 8px；`rounded-lg` 是 10px，`rounded-xl` 是 14px，`rounded-full` 写成 999。
- 字号：web 正文是 `text-sm`（14px），macOS 系统字号是 13。所以以系统字号作为 text-sm，其他档位按差值换算：`text-xs` 是 FontSize-2，`text-lg` 是 FontSize+4。不要写死 14。
- 字重：按钮、Badge、标题用 `font-medium`，即 500。shadcn 很少用 600 以上，只有分区标题偶尔用 600。
- 行高：`leading-relaxed` 是 1.625，用于气泡和描述文字。
- 阴影：`shadow-xs` 是 `0 1px 2px rgba(0,0,0,.05)`，`shadow-sm` 是 `0 1px 3px rgba(0,0,0,.1)`，`shadow-md` 是 `0 4px 6px -1px rgba(0,0,0,.1)`。
- 过渡：Tailwind 默认 150ms，只过渡颜色，不过渡布局。
- 宽度：对话区用 `max-w-3xl`，即 768px，居中。Empty 的描述文字用 `max-w-sm`，即 384px。
- 带图标的按钮，左右内边距比纯文字按钮小一档，对应源码里的 `has-[>svg]:px-*`：default 从 16 变 12，sm 从 12 变 10，xs 从 8 变 6。

## 4. 状态比静态颜色更重要

每个可交互的控件，都要逐项对照源码检查下面这些状态：

| 状态               | shadcn 的做法                                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| hover              | default 变成 `primary/90`；secondary 变成 `/80`；outline 和 ghost 变成 `accent`。dark 下 outline 改用 `input/50`，ghost 改用 `accent/50` |
| focus-visible      | 边框换成 `ring` 色，外面加一圈 3px 的 `ring/50`（可以用 spread 为 3、没有模糊的阴影实现）。只在键盘聚焦时显示                            |
| disabled           | 整体透明度 50%，并且不响应 hover                                                                                                         |
| dark               | outline 和 input 的背景是 `input/30`，destructive 是 `destructive/60`                                                                    |
| selected（侧边栏） | 背景用 `sidebar-accent`，字重 `font-medium`。不用系统强调色                                                                              |

## 5. 组件按 shadcn 的结构来拆

- **Button**：一个函数加一个样式结构体，比如 `button(c, label, buttonStyle{variant, size, icon, disabled})`。结构体的零值就是 shadcn 的 default 样式。不要每个按钮单独写颜色。
- **Badge**：状态标签（等待审批、失败、模型名）用 Badge，不要用彩色文字。
- **Empty**：图标放在 40px 的 muted 方块里，下面是 text-lg 的标题，再下面是 muted 色的描述，最后是操作按钮。
- **Item（outline 变体）**：工具调用这类列表项用 `rounded-md border`，内边距 10–14px。
- **Card**：只给需要停下来处理的东西用，比如审批卡片。样式是 `rounded-xl border shadow-sm`，不要嵌套。
- **InputGroup**：输入框和它的按钮放在同一个边框里，按钮放在 block-end 的 addon 行里。框内有元素获得焦点时，整个外框显示焦点环。
- **Sonner（toast）**：popover 背景，带 border，圆角取 `--radius`。操作按钮高 24px，左右内边距 8px，圆角 4px，xs 字号，primary 配色。
- **图标**：用 lucide，也就是 shadcn 用的那一套。viewBox 24、stroke 2、round cap，颜色跟随文字颜色。

## 6. 验证

1. 改之前，先截一张 light 和一张 dark 的图作为 before。
2. 改完再截 after，逐张对比。重点看：主色有没有还是系统的蓝色、边框是不是太重、dark 下颜色有没有发灰、选中行是不是用的强调色。
3. 动画会影响截图。颜色过渡和 toast 滑入都是按真实时间运行的，截图前要等动画结束（比如 sleep 400ms 再画一帧），否则截到的是过渡中的颜色。
4. 真机上要再看一遍（见 mygo-native-ui skill 里的验证一节）。离屏截图看不出系统强调色、真实字体，也看不出数据缺失这类问题。
