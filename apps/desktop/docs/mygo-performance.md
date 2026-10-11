# mygo 性能：踩过的坑和做法

窗口在流式输出时卡顿、主进程 CPU 跑满 100%，几次查下来都是同一个原因：**有一部分每帧的工作量会随会话变长而变大**。mygo 是即时模式，每来一个事件（`win.Update`）就要把整个视图重建、重新排版一遍，所以这部分工作量必须和会话长度无关。

写新视图或改动会话区之前，先对照下面几条。

## 1. 长列表用 `ui.List`，不要用 Scroll 把所有条目都建出来

**现象**：会话越长，每帧越慢。Spinner、输入框，整个 UI 都在掉帧。

**原因**：放在 `ui.Scroll` 里的条目，包括滚出视野很远的，每帧都要构建、排版。

**做法**：见 [conversation/view.go](../conversation/view.go) 的 `View`：

```go
list.FollowEnd = true // 停在底部时，跟着新内容滚动
ui.List(c, list, t.rows(), func(i int) {
	k, part := t.row(i) // 第 i 行属于哪个 Block，是它的第几行
	...
}).Selectable()
```

- `ui.List` 只构建视野里的条目，状态放在 `ui.ListState` 里（见 [app/session.go](../app/session.go)）。
- **不要拿指针做 Key**。mygo 按值比较 Key，两个内容相同的条目会被判成重复 Key，然后 panic。会话条目只会追加，直接用索引就够了，不必加 Key。
- **一行不能太大**。List 只能跳过整行。一条回复如果整个算一行，400 段的回复每个增量都要把 400 段全部建出来、排版一遍（每帧 72ms）。现在回复的每个 Markdown 块各占一行（每帧 1.9ms），见 [conversation/logic.go](../conversation/logic.go) 的 `rows`、`row`：
  - `starts[b]` 是第 b 个 Block 的起始行号。只有最后一个 Block 会变长，所以前面的只数一次；查找用 `sort.Search`，0 行的 Block 自然跳过。
  - 行之间不用 `Gap`：每个 Block 的第一行加 16 的上边距，块内的行用块自己的间距。
  - `Selectable()` 放在 List 上，选择才能跨行。行里不要再各自设 `Selectable()`，否则会变成独立的选择；不该选的部分（Work、空状态）用 `Unselectable()`。
  - 按 Block 定位的地方（如检查器的 `ScrollIntoView`）要先换算成行号：`t.RowOf(block)`。
- **行内的长列表自己窗口化**。展开的 Work 是一行，里面可能有几百个步骤。步骤行高固定（`stepHeight`），所以只建视野内、上下各多一屏的步骤，其余用等高的空 Box 占位，见 [conversation/work_view.go](../conversation/work_view.go) 的 `stepsWindow`：
  - 视野用上一帧 List 的 `Bounds()`，步骤的位置用上一帧绘制时 `Draw` 拿到的 rect（都是窗口坐标）。
  - 上一帧的位置会过时：一次滚动超过一屏时，建出来的范围可能盖不住视野。所以在 `Draw` 里检查，盖不住就 `c.Invalidate()` 再建一帧。只在位置确实变了时才请求，避免死循环。
  - 位置还不知道时（第一次出现），全部构建。
  - 滚进窗口的步骤不能播放 Enter 动画（父元素上一帧就在），所以 Cascade 只用在展开过程中和新来的步骤上，其余用 `ColorTransition`。

## 2. 正在增长的长文本要切段，不能放在一个 `ui.Text` 里

**现象**：展开 thinking 后，只要它还在输出，CPU 就一直 100%。80KB 的 thinking 每帧要 161ms。

**原因**：mygo 的文字排版缓存按**整段文本**作键（`internal/text` 的 `layouts map[Params]*cached`，`Params` 包含完整文本、宽度和样式）。文本每变一次，缓存就失效，整段都要交给 CoreText 重新排版。`ui.List` 帮不上忙，因为这一个条目本身就一直在视野里。另外，超过 8MB 的排版结果根本不进缓存。

**做法**：见 [conversation/markdown.go](../conversation/markdown.go) 的 `pieces`：

- 回复和 thinking 按 Markdown 分块，每块一个 `RichText`，块与块天然切开。一个段落超过约 2KB 时，在下一个换行处再切开，切出来的每段作为一个 gap 为 0 的块。
- 切点只由前面已有的文本决定。文本变长时，已经切出的段落不变，直接用缓存，只有最后一段需要重新排版。检查器里 2KB 到 80KB 的 thinking 边写边看，每帧耗时不变。
- 把 `Selectable()` 设在外层 Column（或 `ui.List`）上，不要设在各个块上。这样拖动选择可以跨块，复制时各块之间用换行连接，正好补回切掉的换行，复制出来的内容和原文一致。
- 不要按"内容是否变化"来切分（例如每帧按当前长度均分），否则切点会移动，每段的缓存都会失效。

## 3. 和负载大小成正比的计算，在事件到来时算一次

**现象**：agent 写大文件时（比如"写个 single page html todo app"），每帧变慢；历史里这类工具调用越多越慢。

**原因**：`write` 工具的参数就是整个文件。工具卡片的标题每帧都要对完整参数调用 `format.OneLine`，而且历史里的每个调用都要算一遍。

**做法**：在 `tool_start` 事件里算好，存到 `ToolCall.Summary`（见 [conversation/logic.go](../conversation/logic.go)）：

```go
Summary: format.OneLine(format.Head(e.Args, 512))
```

`format.Head` 截取前 n 个字节，不会把多字节字符切断。视图函数里只读算好的字段。凡是对完整输出、参数或文件内容做的处理（解析、换行统计、diff），都按这个办法处理。

**流式 Markdown 也一样**：goldmark 只能整篇解析，所以不能每来一个增量就把整条回复重新解析一遍。见 [conversation/markdown.go](../conversation/markdown.go) 的 `markdown.update`：

- 在"空行之后、顶格开始、不在围栏里"的行前切开。这样的切点前后不会有块跨过去（缩进的行可能是列表项的续行，围栏里的空行属于代码，都不切）。
- 切点之前的部分只解析一次，结果固定下来；只有最后一个切点之后、还在写的那几块，随文本增长重新解析。每个增量约 30µs，和回复长度无关。
- 重新解析时，代码块按出现顺序复用上一次的 `*fenced`，它的 `syntax.Block` 跟着保留，已经着好的颜色不会丢。
- **顶格的代码块前后也切开**，因为除了 HTML 块，没有别的块能跨进或跨出它。代码块还开着的时候，写进来的内容原样交给它的代码，不经过 goldmark（`openFence`）。2000 行的代码块流式写完，累计分配从 1.1GB 降到 2.6MB，耗时从 269ms 降到 9ms（`BenchmarkStreamingALongFence`）。
  - 那 1.1GB 是整个流式过程的**累计分配**，GC 会回收，不是常驻内存。来源是每个增量都在做 O(代码块长度) 的事：goldmark 重新解析整个代码块、`[]byte(src)` 复制、重新拼出代码字符串、重建最后一个 chunk 的 span。约 4000 个增量 × 平均几十 KB × 几份拷贝，就是几百 MB 到 1GB。
  - 等价性由 `TestAStreamedReplyShowsAsItsWholeParse` 保证：逐字节流式输入，每一步都和整篇解析的结果比较。
- **只追加的文本用 `strings.Builder`**：`Item.written` 收集增量，`Item.Text = written.String()` 不拷贝。`text += delta` 每次都会拷贝整段。

**也不要在视图里新建要在后台计算的东西**。检查器以前每帧为运行中的调用重新算一遍行，每次都 `syntax.NewBlock`：新 Block 要在后台 lex，lex 完调用 `Ready` 触发下一帧，下一帧又建新 Block，结果是调用运行多久，就空转多久。现在在调用开始、结束时各算一次（`inspectLines`）。同理，代码块把 token 转成 span 的结果缓存在 `fenced.chunks` 里，行没变就不重算。

**增量也要只算变的那部分**：

- `fenced.chunks` 从第一个变了的行开始重建；最后一个 chunk 记下每行之后的 span 数（`ends`），只截掉变了的行再追加，不整块重建。
- `syntax.Block.Lines()` 里已着色的行只追加，不重新拷贝。
- 着色很慢（chroma 约 1MB/s）。一次 lex 超过 `slowLex`（4ms）的块，下次 lex 前先休息两倍时长，期间新行先按纯文本显示，到点再用 `syntax.Ready` 重绘。不然一个大块每个增量都要整块重新 lex，后台 goroutine 一直跑满。

## 4. 持续动画只重绘，不要每帧重建视图

**现象**：Spinner 看着卡，像掉帧。转得也不匀。

**原因**：`Element.Loop`、`Element.Animate` 和 `Context.AnimationFrame` 都会在每个显示帧**重建整个视图**。视图一慢，所有动画都跟着卡，又反过来加重重建负担。

**做法**：

- 外观在动、但布局不变的东西（比如 Spinner），用 `Draw` 自己画，并在其中调用 `Painter.After(components.UntilTick(p.Now()))`，每个 `components.Tick`（1/30 秒）重绘一次。这样的帧只重绘，不运行视图函数。见 [ui/components/display.go](../ui/components/display.go) 的 `Spinner`。
- **不要用 `Painter.AnimationFrame()`**。它按显示器的最高刷新率要帧（ProMotion 屏上是 120Hz），而每次重绘都要把整个窗口画一遍（遍历所有元素、提交 scene、玻璃材质）。一个 16px 的 Spinner 就能让窗口一直以 120fps 重画，回复进行时主进程 CPU 一直降不下来。所有 Spinner 用同一个时钟对齐到 Tick，同一帧就把它们全部画完。
- 按秒变化的文本（比如已用时间），用 `c.After(time.Second - elapsed%time.Second)` 在下一秒整点重建一次。不要靠动画顺带刷新。见 [app/statusline.go](../app/statusline.go)。
- 折叠的 `CollapsibleBase` 不会构建面板内容，不占成本。展开以后才要算它的成本，见第 2 条。
- **带 `Exit` 的 Transition 让每次重建都重新分配元素**：只要上一帧建过带 Exit 的元素（`components.Rise`、检查器的 `panelMotion`），mygo 就会把元素 arena 和备用 arena 对调，`finish` 再把备用的那块裁到只剩一个 chunk，下一帧只好重新分配。会话区一般 150 多个元素，每次重建约多分配 240KB（`MYGO_FRAME_STATS` 里表现为每帧固定 5 次、共 240KB 的分配）。这是 mygo 的问题，v0.4.2 仍然如此；在应用这边，控制重建的次数（见第 5 条“当前会话也按 Tick 取事件”）就是控制这部分垃圾。

## 5. 不在眼前的东西不要触发重建

- **事件合并**：会话的事件先放进 `inbox`，只有放进去的是当时第一条时才调用 `a.update`，update 里把整批 Apply 掉。打开会话时读历史只要几帧，而不是一个事件一帧。见 [app/app.go](../app/app.go) 的 `open`、`drain`。
- **当前会话也按 Tick 取事件**：回复的 delta 每秒能来上百个，以前几乎每个显示帧都要重建一次视图。现在在下一个 `components.Tick` 取（`a.after(components.UntilTick(…), drain)`），和 Spinner 的重绘落在同一帧，流式输出每秒最多重建 30 次。
- **后台会话节流**：不在显示的会话，事件每 `backgroundEvery`（250ms）才取一次。否则后台会话每来一个增量，就要把当前窗口整个重建一遍，而这些变化没人看得到。`show` 切换会话时会立刻取走积压的事件。
- **视图回收**：最多跟踪 `keptViews` 个最近显示过的会话；更早的、闲置且草稿为空的会话会被关掉，连同它的 Transcript 一起释放，再次选中时重新读取。

## 6. 怎么测

- **离线基准测试**：用 `ui.NewTester(view, 1180, 780)` 构造一个大会话，循环执行"追加增量 + `tt.Frame()`"，记录每帧耗时。**要比较不同会话规模下的耗时**（如 2KB / 20KB / 80KB，或 40 / 400 条），看它会不会随会话变长而增长。绝对值意义不大：Tester 每帧都要把整个窗口画成图片，这部分固定开销约 4ms。
- Tester 有两个局限：`Frame()` 每次都会重建视图，而且最多连续执行 20 轮；它也看不出"只重绘、不重建"的帧。所以第 4 条的效果，要在真实窗口里测量。
- **真实窗口**：用假的 SSE 服务按固定速率发送增量，再用 `top`、`sample` 观察主进程。启动 GUI 窗口前，先征得用户同意。
- 修好后，用 `SNAPSHOT=… go test ./app -run TestSnapshot` 截图，和修改前的截图逐像素比较，确认外观没有变化。
