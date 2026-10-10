# mygo API 速查（v0.3.7，apps/desktop 中实际用过的）

签名以 `$M/ui/api_gen.go` 为准，其中 `M=$(go list -m -f '{{.Dir}}' github.com/egoist/mygo)`。

## App 和窗口（package mygo）

```go
mygo.App.WhenReady(func() { ... })         // 在这里创建窗口和菜单
mygo.App.OnWillQuit(func(*mygo.QuitEvent) { ... })
mygo.App.SetMenu(mygo.NewMenu([]*mygo.MenuItem{
	{Role: mygo.RoleAppMenu},
	{Label: "File", Submenu: []*mygo.MenuItem{
		{Label: "New Session", Accelerator: "CmdOrCtrl+N", Click: func(*mygo.MenuItem, *mygo.Window) { win.Update(...) }},
		mygo.Separator(),
		{Role: mygo.RoleClose},
	}},
	{Role: mygo.RoleEditMenu}, {Role: mygo.RoleViewMenu}, {Role: mygo.RoleWindowMenu},
}))
win = mygo.NewWindow(mygo.WindowOptions{Title, Width, Height, MinWidth, MinHeight, StateKey: "main", Content: ui.View(a.View)})
win.Update(fn)                             // 在主线程执行 fn，然后重绘
mygo.Dialog.Open(mygo.OpenDialogOptions{Parent: win, Directory: true, CreateDirectories: true, Title, ButtonLabel}) // 会阻塞
err := mygo.App.Run()
```

## Context

`c.Theme()`、`c.SetTheme(t)`、`c.Key(id)`、`c.Shortcut(mods, key)`、`c.ToastAction(msg, label, fn)`、`c.Services().Invalidate()`

## 控件

| 用途       | API                                                                                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 左右分栏   | `ui.Split(c, &size, first, second)`                                                                                                                         |
| 侧边栏     | `ui.Sidebar(c, &selected, fn).Changed()`、`ui.SidebarSection(c, title, &open, fn)`、`ui.SidebarItem(c, id, icon, label)`                                    |
| 折叠       | `ui.Collapsible(c, label, &open, fn)`                                                                                                                       |
| 滚动       | `ui.Scroll(c).TrackScroll(&ui.ScrollState{})`                                                                                                               |
| 文字、图标 | `ui.Text`、`ui.Textf`、`ui.Icon(c, svg)`、`ui.MustParseSVG`                                                                                                 |
| 无样式按钮 | `ui.ButtonBase(c)`                                                                                                                                          |
| 下拉选择   | `sel := ui.SelectBase(c, &v)`，然后用 `sel.Trigger`、`sel.Popup(func(panel ui.Element))`、`sel.Item(v).Highlighted()`                                       |
| 输入       | `ui.TextInputBase(c, &s)`、`ui.TextAreaBase(c, &s).Lines(2, 8).Placeholder(..).HandleInput(fn)`                                                             |
| Toast      | `ui.ToastViewportBase(c, func(viewport ui.Element, toasts []ui.Toast))`，在回调里对每个 toast 调 `ui.ToastBase(c, t)`，用 `.Root` 和 `.ActionButton()` 构建 |
| 右键菜单   | `.ContextMenu(func(m *ui.Menu) { m.Item(x).Disabled(b).Chosen(); m.Separator() })`                                                                          |

## 元素方法

- **布局**：`Row`、`Column`、`Box`；`Grow`、`Shrink`、`Fill`、`Center`、`Size`、`Height`、`MaxWidth`、`MinWidth`、`Justify`、`AlignItems`、`AlignSelf`、`Wrap`、`Gap`、`Padding`、`Margin`
- **外观**：`Background`、`TextColor`、`Radius`、`Border(w, c)`、`BorderWidth(t, r, b, l)`、`BorderColor`、`Shadow(x, y, blur, spread, c)`、`Opacity`
- **文字**：`FontSize`、`FontWeight`、`LetterSpacing`、`LineHeight`、`FontFeatures("tnum")`、`Font("monospace")`、`TextAlign`、`SingleLine`、`MaxLines`、`Selectable`
- **状态**：`Disabled`、`Hovered`、`Focused`、`FocusVisible`、`FocusWithin`、`FocusRing(false)`
- **动画**：`Transition(ui.ElementTransition{...})`、`Rotate`、`Loop(key, period, ease)`
- **事件**：`Clicked`、`Changed`、`HandleInput`
- **无障碍和测试**：`Label`（同时也是 Tester 查找时用的名字）、`Tooltip`、`Key`

## 颜色

`ui.Oklch(l, c, h)`、`ui.RGBA(r, g, b, a)`、`Color.Alpha(a)`（在原有 alpha 上相乘）、`Color.Mix`

## Tester

`ui.NewTester(view, w, h)`，可用方法：

- 交互：`Click`、`ClickAt`、`RightClick`、`Type`、`Key(mods, key)`、`TypeKey`、`Scroll`
- 查找：`HasText`、`Texts`、`Find`
- 菜单：`Menu`、`ChooseMenuItem`
- 环境：`SetDark`、`SetScale`、`SetSize`
- 渲染：`Frame`、`Image`
