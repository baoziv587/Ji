# mygo 性能：踩过的坑和做法

窗口在流式输出时卡顿、主进程 CPU 跑满 100%，几次查下来都是同一个原因：**有一部分每帧的工作量会随会话变长而变大**。mygo 是即时模式，每来一个事件（`win.Update`）就要把整个视图重建、重新排版一遍，所以这部分工作量必须和会话长度无关。

写新视图或改动会话区之前，先对照下面几条。

## 1. 长列表用 `ui.List`，不要用 Scroll 把所有条目都建出来

**现象**：会话越长，每帧越慢。Spinner、输入框，整个 UI 都在掉帧。

**原因**：放在 `ui.Scroll` 里的条目，包括滚出视野很远的，每帧都要构建、排版。

**做法**：见 [conversation/view.go](../conversation/view.go) 的 `View`：

```go
list.FollowEnd = true // 停在底部时，跟着新内容滚动
ui.List(c, list, len(t.Items), func(i int) {
	Centered(c, 0, func() { item(c, t.Items[i]) })
})
```

- `ui.List` 只构建视野里的条目，状态放在 `ui.ListState` 里（见 [app/session.go](../app/session.go)）。
- **不要拿指针做 Key**。mygo 按值比较 Key，两个内容相同的条目会被判成重复 Key，然后 panic。会话条目只会追加，直接用索引就够了，不必加 Key。

## 2. 正在增长的长文本要切段，不能放在一个 `ui.Text` 里

**现象**：展开 thinking 后，只要它还在输出，CPU 就一直 100%。80KB 的 thinking 每帧要 161ms。

**原因**：mygo 的文字排版缓存按**整段文本**作键（`internal/text` 的 `layouts map[Params]*cached`，`Params` 包含完整文本、宽度和样式）。文本每变一次，缓存就失效，整段都要交给 CoreText 重新排版。`ui.List` 帮不上忙，因为这一个条目本身就一直在视野里。另外，超过 8MB 的排版结果根本不进缓存。

**做法**：见 [conversation/view.go](../conversation/view.go) 的 `streamed` / `pieces`：

- 每过约 2KB，在下一个换行处切开，每段一个 `ui.Text`。
- 切点只由前面已有的文本决定。文本变长时，已经切出的段落不变，直接用缓存，只有最后一段需要重新排版。修改后，80KB 的 thinking 每帧约 4ms。
- 把 `Selectable()` 设在外层 Column 上，不要设在各个 Text 上。这样拖动选择可以跨段，复制时各段之间用换行连接，正好补回切掉的换行，复制出来的内容和原文一致。
- 不要按"内容是否变化"来切分（例如每帧按当前长度均分），否则切点会移动，每段的缓存都会失效。

## 3. 和负载大小成正比的计算，在事件到来时算一次

**现象**：agent 写大文件时（比如"写个 single page html todo app"），每帧变慢；历史里这类工具调用越多越慢。

**原因**：`write` 工具的参数就是整个文件。工具卡片的标题每帧都要对完整参数调用 `format.OneLine`，而且历史里的每个调用都要算一遍。

**做法**：在 `tool_start` 事件里算好，存到 `ToolCall.Summary`（见 [conversation/logic.go](../conversation/logic.go)）：

```go
Summary: format.OneLine(format.Head(e.Args, 512))
```

`format.Head` 截取前 n 个字节，不会把多字节字符切断。视图函数里只读算好的字段。凡是对完整输出、参数或文件内容做的处理（解析、换行统计、diff），都按这个办法处理。

## 4. 持续动画只重绘，不要每帧重建视图

**现象**：Spinner 看着卡，像掉帧。转得也不匀。

**原因**：`Element.Loop`、`Element.Animate` 和 `Context.AnimationFrame` 都会在每个显示帧**重建整个视图**。视图一慢，所有动画都跟着卡，又反过来加重重建负担。

**做法**：

- 外观在动、但布局不变的东西（比如 Spinner），用 `Draw` 自己画，并在其中调用 `Painter.AnimationFrame()`。这样的帧只重绘，不运行视图函数。见 [ui/components/display.go](../ui/components/display.go) 的 `Spinner`。
- 按秒变化的文本（比如已用时间），用 `c.After(time.Second - elapsed%time.Second)` 在下一秒整点重建一次。不要靠动画顺带刷新。见 [app/statusline.go](../app/statusline.go)。
- 折叠的 `CollapsibleBase` 不会构建面板内容，不占成本。展开以后才要算它的成本，见第 2 条。

## 5. 怎么测

- **离线基准测试**：用 `ui.NewTester(view, 1180, 780)` 构造一个大会话，循环执行"追加增量 + `tt.Frame()`"，记录每帧耗时。**要比较不同会话规模下的耗时**（如 2KB / 20KB / 80KB，或 40 / 400 条），看它会不会随会话变长而增长。绝对值意义不大：Tester 每帧都要把整个窗口画成图片，这部分固定开销约 4ms。
- Tester 有两个局限：`Frame()` 每次都会重建视图，而且最多连续执行 20 轮；它也看不出"只重绘、不重建"的帧。所以第 4 条的效果，要在真实窗口里测量。
- **真实窗口**：用假的 SSE 服务按固定速率发送增量，再用 `top`、`sample` 观察主进程。启动 GUI 窗口前，先征得用户同意。
- 修好后，用 `SNAPSHOT=… go test ./app -run TestSnapshot` 截图，和修改前的截图逐像素比较，确认外观没有变化。
