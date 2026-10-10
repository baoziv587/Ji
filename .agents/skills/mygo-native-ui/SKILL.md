---
name: mygo-native-ui
description: 用 mygo（github.com/egoist/mygo）的 ui 包写原生桌面界面的经验，涵盖即时模式视图、主线程与后台更新、主题、基于 *Base 的自定义控件、Tester 和离屏截图、打包与真机验证。修改 apps/desktop 或任何 mygo native UI 时使用。
---

# 用 mygo 写原生界面

本仓库的例子是 `apps/desktop`。`main.go` 只负责组装，状态和视图放在 `agentui/` 里。

## 先查哪里

- 本地文档：`M=$(go list -m -f '{{.Dir}}' github.com/egoist/mygo)`，然后看 `$M/docs/ui/*.md`。每个控件都有一篇，另外还有 `styling`、`transitions`、`custom-widgets`、`testing`、`toast`、`sidebar`、`select` 等专题。包的总体说明在 `$M/ui/doc.go`，例子在 `$M/examples`。
- API 的准确签名：grep `$M/ui/api_gen.go`，例如 `grep -n ") Hovered() bool" $M/ui/api_gen.go`。不要凭记忆写方法名。
- `go tool mygo install-skills` 可以安装 mygo 自带的 agent skill；`go tool mygo vet` 会在 `go vet` 之外检查 UI 元素的生命周期。

## 命令

```sh
go tool mygo dev     # 热重载。会在 .mygo/dev 下打出 "<name> Dev".app，而且不传命令行 flag
go tool mygo build   # 生成 build/darwin-arm64/<name>.app 和 .dmg；名字和 bundle id 取自 mygo.json
go run .             # 不要写 go run main.go：单独编译一个文件，会找不到同包其它文件里的定义
```

- 要求 Go ≥ 1.27.1，`GOTOOLCHAIN=auto` 会自动下载。
- 因为 `dev` 不传 flag，所以每个 flag 都要能从环境变量读到（本仓库用的是 `JI_AGENT_*`）。

## 心智模型

- **即时模式。** `ui.View(a.View)` 每帧都会重新调用 `func(c *ui.Context)`。状态存在你自己的结构体里，以指针形式交给控件，比如 `&a.draft`、`&a.selected`、`&open`。`Clicked()`、`Changed()` 是构建这一帧时就能直接读的布尔值。
- **元素只在当前帧有效。** 不要把 Element 或 Context 存进状态，也不要交给 goroutine。
- **列表要加 Key。** 元素的状态（焦点、滚动、动画）按它在兄弟中的位置来对应。列表项要用 `c.Key(id)` 或 `.Key(id)` 固定身份；同一父元素下 key 重复时，Tester 会 panic。

## 主线程和后台

- 窗口和菜单在 `mygo.App.WhenReady(fn)` 里创建。闭包要用到 `win` 时，先写 `var win *mygo.Window`，再赋值。
- 后台 goroutine 要改状态，一律通过 `win.Update(func(){ ... })`：它在主线程执行，然后重绘。只想重绘时用 `Invalidate()`。
- 推荐让 App 持有两个函数字段：`update func(func())`（生产环境是 `win.Update`）和 `async func(func())`（生产环境是 `go fn()`）。测试里两者都直接调用，测试就变成同步的。
- `mygo.Dialog.Open` 会阻塞，要在 async 里调用，结果再用 update 写回。
- 只能在 view 里调用的 API（如 `c.ToastAction`）：先把要做的事记在状态里（例如 `a.toast`），下一帧在 View 里再执行。
- 菜单加速键的回调里，也要通过 `win.Update` 修改状态。

## 主题

- `c.Theme()` 是系统主题：light 或 dark，并且跟随系统强调色。macOS 上 `FontSize` 是 13，其它平台是 14。
- `c.SetTheme(t)` 会整个替换主题，替换后**不再跟随系统强调色**。
  - 做法：从 `c.Theme()` 复制一份，覆盖颜色后缓存起来；只有 `Dark` 或 `FontSize` 变化时才重建，然后每帧调用 `SetTheme`。参见 `agentui/theme.go`。
- `Color.Alpha(a)` 是**在原有 alpha 上相乘**，不是直接设定 alpha。
- `ui.Oklch(l, c, h)` 可以直接写设计令牌。
- `Theme.Inverse` 和 `InverseText` 默认是零值。内置的 tooltip 和 toast 会回退到 Text/Background，但用 `ToastBase` 自己绘制时如果直接读 `t.Inverse`，就会画成透明。所以要么把这两个字段设上，要么用自己的颜色。

## 自定义外观：用 `*Base` 控件

内置控件会把主题的 `Accent` 用在界面上，比如 `SidebarItem` 的选中行就是 Accent 底色。如果要做成 shadcn 那种中性色设计，有两种办法：

- **只差颜色**：在内置控件上直接覆盖。例如 SidebarItem 选中时写 `.Background(p.SidebarAccent).TextColor(p.Foreground).FontWeight(500)`。
- **整体外观不同**：改用没有预设外观的 base 控件。它们负责指针、键盘、焦点和无障碍，外观完全由你来画。
  - `ButtonBase`
  - `SelectBase(c, &v)`：通过 `.Trigger`、`.Popup(func(panel))`、`.Item(v).Highlighted()` 构建
  - `TextInputBase`
  - `TextAreaBase`
  - `ToastViewportBase(c, func(viewport, toasts))` 加 `ToastBase`：通过 `.Root`、`.ActionButton()` 构建
  - 参考实现在 `agentui/components.go`。

状态的写法：

- **先禁用，再读 hover。** `Hovered()` 在被调用的那一刻检查 disabled，所以 `b.Disabled(true)` 必须写在 `b.Hovered()` 之前，否则禁用的按钮也会显示悬停色。
- **焦点环**：先用 `FocusRing(false)` 关掉默认焦点环。`FocusVisible()` 只在键盘聚焦时为真，这时用 `Shadow(0, 0, 0, 3, ring.Alpha(.5))` 画一圈 3px 的焦点环。
  - 外框里的输入框获得焦点时，外框用 `FocusWithin()` 判断。
  - 自己画外框的单行输入，用 `input.Focused()` 判断。
- **颜色过渡**：`Transition(ui.ElementTransition{Duration: 150 * time.Millisecond, Colors: true})`。
- **转圈动画**：`icon.Rotate(icon.Loop("spin", time.Second, ui.Linear) * 360)`。
- **图标**：`ui.MustParseSVG` 支持 stroke，`currentColor` 取自 `TextColor`。lucide 的 path 外面包一层 `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ...>` 就能直接用。

## 布局

- 基本是 flexbox：`Row`、`Column`、`Box`、`Scroll`，配合 `Grow`、`Shrink`、`Fill`、`Justify`、`AlignItems`、`Gap`、`Padding`（参数顺序同 CSS）、`BorderWidth(t, r, b, l)` 加 `BorderColor`。
- Row 里的长文本要加 `.SingleLine()` 或 `MaxLines(n)`，同时加 `Shrink(1)`，否则会把同一行的其它元素挤出去。不想被挤压的按钮加 `Shrink(0)`。
- 居中并限制宽度的列：`Row().Justify(ui.Center)` 里面放 `Column().Grow(1).MaxWidth(768)`。
- 自动滚到底部：`Scroll().TrackScroll(&state)`。如果用户已经在底部附近（`state.Y >= MaxY-4`），就把 `Y` 设成 `math.MaxFloat32`。

## 键盘

- TextArea 会把 Enter 和 Shift+Enter 都当作换行吃掉，`Submitted()` 只对单行输入有效。要做到"Enter 发送、Shift+Enter 换行"，在 TextArea 上挂 `.HandleInput(func(ev ui.InputEvent) bool { ... })`：当事件是 `InputKeyDown`、键是 `KeyEnter`、`Mods == 0` 时发送，并返回 true 把这个键吞掉。用 `c.Shortcut` 或者比较前后文本都区分不出这两种按键。
- 窗口内的快捷键：`c.Shortcut(0, ui.KeyEscape)`。全局命令放在菜单里：`mygo.MenuItem{Accelerator: "CmdOrCtrl+N"}`。

## 测试和离屏截图

- `ui.NewTester(view, w, h)` 提供：`Click(文字或 Label)`、`Type`、`Key`、`HasText`、`Texts`、`Find`、`SetDark`、`Frame`、`Image`。
- `Click` 只点**第一个**文字完全相等的元素，而且没有 FindAll。名字重复时，要么改名，要么给元素一个唯一的 `.Label`。纯图标按钮必须设 `Label`，它既是无障碍名称，也是测试查找时用的名字。
- 在 view 外面改了状态以后，先调 `tt.Frame()`，再去断言或点击。
- **没有假时钟。** 颜色过渡和 toast 动画都按真实时间进行，截图前要 `time.Sleep(400 * time.Millisecond)`，再调一次 `tt.Frame()`。
- 默认缩放是 1x，1180×780 的视图就得到 1180×780 像素。裁剪图片时不要按 2x 计算坐标。可以用 `sips --cropOffset Y X -c H W` 裁剪，再用 `sips -z` 放大来看。
- 本仓库的截图命令：

  ```sh
  SNAPSHOT=/tmp/out.png go test ./agentui -run TestSnapshot
  ```

  加上 `DARK=1` 截深色，加上 `TOAST=1` 截出现 toast 的状态。

- 想用真实服务端截图时，让 update 把 fn 写进 channel，测试循环里取出来执行，再调 `tt.Frame()`。

## 打包和真机验证

- 从 Finder 或 `open` 启动的 app，工作目录是 `/`，而且拿不到 shell 的环境变量（比如 API key）。
  - 代码里要把 `/` 当作 home 目录处理。
  - 验证时直接从 shell 运行 `"build/.../<name>.app/Contents/MacOS/<name>"`，这样环境变量会被继承。
- 窗口的位置和大小交给 `WindowOptions.StateKey` 保存。其它布局（比如侧边栏宽度）自己写到 `os.UserConfigDir()` 下。
- 离屏截图看不出这些问题：系统强调色、透明的 toast、真实数据缺失（比如服务端没有发出 state 事件）。所以 GUI 还要在真机上验证。
  - 用 Codex app-server 加 computer use，流程见记忆里的 verify-via-codex-app-server。
  - Codex 只认打包好的 .app。
  - 验证前先 `pgrep -fl "<name>.app"`，把旧实例退掉。否则新启动的进程会立即退出，验证到的其实是旧实例。
  - 再用 `defaults read -g AppleInterfaceStyle` 确认系统外观，免得把深色模式下的正常表现当成 FAIL。

API 速查见 [references/api.md](references/api.md)。
