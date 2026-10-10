# shadcn/ui 数值速查（new-york-v4，neutral 主题）

来源是 `npx shadcn@latest view @shadcn/theme-neutral` 和各组件的源码。实际代码见 `apps/desktop/agentui/theme.go` 和 `components.go`。

## 颜色令牌（OKLCH）

| 令牌                       | light              | dark               |
| -------------------------- | ------------------ | ------------------ |
| background                 | 1 0 0              | 0.145 0 0          |
| foreground                 | 0.145 0 0          | 0.985 0 0          |
| card / popover             | 1 0 0              | 0.205 0 0          |
| primary                    | 0.205 0 0          | 0.922 0 0          |
| primary-foreground         | 0.985 0 0          | 0.205 0 0          |
| secondary / muted / accent | 0.97 0 0           | 0.269 0 0          |
| muted-foreground           | 0.556 0 0          | 0.708 0 0          |
| destructive                | 0.577 0.245 27.325 | 0.704 0.191 22.216 |
| border                     | 0.922 0 0          | 1 0 0 / 10%        |
| input                      | 0.922 0 0          | 1 0 0 / 15%        |
| ring                       | 0.708 0 0          | 0.556 0 0          |
| sidebar                    | 0.985 0 0          | 0.205 0 0          |
| sidebar-accent             | 0.97 0 0           | 0.269 0 0          |
| sidebar-border             | 0.922 0 0          | 1 0 0 / 10%        |
| radius                     | 0.625rem（10px）   | 同左               |

shadcn 没有 success 和 warning 令牌，用 Tailwind 的 green-600 / amber-600 代替：light 是 `0.627 0.194 149.214` 和 `0.666 0.179 58.318`；dark 用 green-500 / amber-500，是 `0.723 0.219 149.579` 和 `0.769 0.188 70.08`。

## 映射到 mygo 的 `ui.Theme`（themeFrom）

| ui.Theme 字段                                     | 取值                                                     |
| ------------------------------------------------- | -------------------------------------------------------- |
| Background, Text, TextMuted, Border               | background, foreground, muted-foreground, border         |
| Surface / SurfaceHover / SurfacePressed           | secondary / accent / accent                              |
| Accent / AccentHover / AccentPressed / AccentText | primary / primary·0.9 / primary·0.8 / primary-foreground |
| Danger                                            | destructive                                              |
| Inverse / InverseText（tooltip）                  | foreground / background                                  |
| Selection / Focus / Scrollbar                     | ring·0.35 / ring·0.5 / foreground·0.25                   |
| Radius / Spacing                                  | 8 / 4                                                    |

## Button

| size              | 高            | px（有图标时）  | gap | 图标    |
| ----------------- | ------------- | --------------- | --- | ------- |
| default           | 36            | 16（12）        | 8   | 16      |
| sm                | 32            | 12（10）        | 6   | 16      |
| xs                | 24            | 8（6），text-xs | 4   | 12      |
| icon-sm / icon-xs | 32×32 / 24×24 | 0               | 0   | 16 / 12 |

所有尺寸都是 `rounded-md`，字重 500。

| variant     | 背景                         | 文字               | hover                     | 其他                                    |
| ----------- | ---------------------------- | ------------------ | ------------------------- | --------------------------------------- |
| default     | primary                      | primary-foreground | primary/90                |                                         |
| secondary   | secondary                    | foreground         | secondary/80              |                                         |
| outline     | background；dark 下 input/30 | foreground         | accent；dark 下 input/50  | border（dark 下用 input 色）+ shadow-xs |
| ghost       | 透明                         | foreground         | accent；dark 下 accent/50 |                                         |
| destructive | destructive；dark 下 /60     | white              | destructive/90            |                                         |

## 其他组件

- **Badge**：`rounded-full px-2 py-0.5 text-xs font-medium`。outline 变体是 border 加 foreground 色文字。
- **Kbd**：`h-5 min-w-5 px-1 rounded-sm bg-muted text-xs font-medium text-muted-foreground`。
- **Input**：`h-9 px-3 rounded-md border-input shadow-xs bg-transparent`，dark 下背景是 `input/30`。聚焦时 `border-ring`，外加 `ring-[3px] ring-ring/50`。
- **Textarea**：`min-h-16 px-3 py-2`，其余同 Input。
- **Select**：
  - trigger 尺寸 sm 是 `h-8 px-3 gap-2`，chevron 用 `muted-foreground/50`。
  - content 是 `bg-popover border rounded-md shadow-md p-1 min-w-[8rem]`。
  - item 是 `h-8 rounded-sm px-2`，高亮时用 `bg-accent`，选中项右侧显示 check。
- **Sidebar menu button**：`h-8 p-2 rounded-md gap-2 text-sm`。hover 和 active 都用 `sidebar-accent`，active 时字重 500。
- **Empty**：
  - 媒体块是 `size-10 rounded-lg bg-muted`，图标 `size-6`。
  - 标题 `text-lg font-medium tracking-tight`，描述 `text-sm/relaxed text-muted-foreground`。
  - 整体 `max-w-sm`，内容间距 gap-2。
- **Card**：`rounded-xl border bg-card shadow-sm`，内边距 py-6 px-6；紧凑场景可以用 16。
- **Item outline**：`rounded-md border p-4 gap-4`；紧凑场景 `py-3 px-4`。
- **Bubble（聊天）**：`rounded-xl px-3 py-2 leading-relaxed`。用户消息用 secondary 背景，最大宽度 80%。
- **InputGroup**：`rounded-md border-input shadow-xs`，dark 下背景是 `input/30`。框内有焦点时，外框显示 ring。按钮放在 block-end addon 里，内边距 `px-3 pb-3`。
- **Sonner**：toast 是 `bg-popover border rounded-[--radius]`。操作按钮高 24px、`px-2`、圆角 4px、`text-xs font-medium`，primary 配色。
- **Tooltip**：`bg-foreground text-background rounded-md px-3 py-1.5 text-xs`。
