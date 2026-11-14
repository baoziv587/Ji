package app

// The panel at the right of a session: tabs of what opens beside the
// conversation, a terminal in the session's folder or connected to a
// server, or the changes made there, each a surface; with none open, the
// surfaces it can open.

import (
	"fmt"
	"slices"

	"github.com/egoist/mygo/ui"

	"desktop/agent"
	"desktop/ui/components"
	"desktop/ui/icons"
)

type surfaceKind int

const (
	surfaceTerminal surfaceKind = iota
	surfaceDiff
	// surfaceSSH is a terminal connected to a server the picker then asks
	// for.
	surfaceSSH
)

// surfaceKinds are the surfaces the panel opens, in the order its picker
// lists them, each with the key that opens it there.
var surfaceKinds = []struct {
	kind   surfaceKind
	name   string
	icon   *ui.SVG
	key    ui.Key
	letter string
}{
	{surfaceTerminal, "Terminal", icons.SquareTerminal, ui.KeyT, "T"},
	{surfaceDiff, "Diff", icons.FileDiff, ui.KeyD, "D"},
	{surfaceSSH, "SSH", icons.Machine, ui.KeyS, "S"},
}

// surface is a tab of the panel: a terminal or the diff.
type surface struct {
	id   int
	term *terminalSurface
	diff *diffSurface
}

func (s *surface) name() string {
	if s.term != nil {
		return s.term.name()
	}
	return "Diff"
}

func (s *surface) icon() *ui.SVG {
	if s.term != nil && s.term.host != "" {
		return icons.Machine
	}
	if s.term != nil {
		return icons.SquareTerminal
	}
	return icons.FileDiff
}

// close lets go of the surface's terminal, if it is one.
func (s *surface) close() {
	if s.term != nil {
		s.term.close()
	}
}

// panelState is what the window keeps of a session's panel: whether it
// shows, over the whole room or beside the conversation, its tabs, the
// one shown, and whether the picker of surfaces shows instead.
type panelState struct {
	open      bool
	maximized bool
	picking   bool
	// Whether the picker asks for the server to connect to, and its search.
	hosts      bool
	hostSearch string
	tabs       []*surface
	active     int
	lastID     int
	// Whether a terminal of the panel had the keys in the last frame,
	// for the keys the session's own shortcuts would else take from it.
	typing bool
}

func (p *panelState) shown() *surface {
	if p.picking || p.active < 0 || p.active >= len(p.tabs) {
		return nil
	}
	return p.tabs[p.active]
}

// panelShown is whether the panel shows: the inspector takes its place.
func (v *sessionView) panelShown() bool {
	return v.panel.open && v.t.Inspected == nil
}

// togglePanel shows or hides the session's panel; shown with no tab, it
// offers the surfaces to open.
func (a *App) togglePanel(view *sessionView) {
	pn := &view.panel
	if view.t.Inspected != nil {
		view.t.Inspected = nil
		pn.open = true
	} else {
		pn.open = !pn.open
	}
	if pn.open && len(pn.tabs) == 0 {
		pn.picking = true
	}
	if !pn.open {
		view.refocus = true
	}
}

// openSurface opens a surface of kind in the panel: a terminal anew each
// time, the diff once, read again as it is opened again.
func (a *App) openSurface(s agent.Session, view *sessionView, kind surfaceKind) {
	pn := &view.panel
	switch kind {
	case surfaceSSH:
		pn.open, pn.picking, pn.hosts, pn.hostSearch = true, true, true, ""
		a.loadServers()
	case surfaceTerminal:
		a.openTerminal(s, view, "")
	case surfaceDiff:
		a.openDiff(s, view)
	}
}

// openDiff shows the panel's diff, read again, or opens it.
func (a *App) openDiff(s agent.Session, view *sessionView) {
	pn := &view.panel
	pn.open, pn.picking = true, false
	if i := slices.IndexFunc(pn.tabs, func(t *surface) bool { return t.diff != nil }); i >= 0 {
		pn.active = i
		a.loadDiff(pn.tabs[i].diff)
		return
	}
	pn.lastID++
	tab := &surface{id: pn.lastID, diff: &diffSurface{root: s.Root}}
	a.loadDiff(tab.diff)
	pn.tabs = append(pn.tabs, tab)
	pn.active = len(pn.tabs) - 1
}

// serverTab is the tab of the terminal connected to the server alias,
// -1 for none.
func (pn *panelState) serverTab(alias string) int {
	return slices.IndexFunc(pn.tabs, func(t *surface) bool {
		return t.term != nil && t.term.host == alias
	})
}

// openTerminal opens a terminal in the panel, of the user's shell or
// connected to host, and shows it.
func (a *App) openTerminal(s agent.Session, view *sessionView, host string) {
	pn := &view.panel
	pn.open, pn.picking = true, false
	pn.lastID++
	tab := &surface{id: pn.lastID}
	term, err := a.startTerminal(s, view, tab, host)
	if err != nil {
		a.toast = &toast{message: "Could not open a terminal: " + err.Error()}
		pn.picking = len(pn.tabs) == 0
		return
	}
	tab.term = term
	pn.tabs = append(pn.tabs, tab)
	pn.active = len(pn.tabs) - 1
}

// closeSurface closes a tab, and its terminal; the last one closed, the
// picker shows.
func (a *App) closeSurface(view *sessionView, tab *surface) {
	pn := &view.panel
	i := slices.Index(pn.tabs, tab)
	if i < 0 {
		return
	}
	tab.close()
	pn.tabs = slices.Delete(pn.tabs, i, i+1)
	if pn.active > i || pn.active == len(pn.tabs) {
		pn.active--
	}
	if len(pn.tabs) == 0 {
		pn.active, pn.picking = 0, true
	}
}

// close lets go of every surface of a session the window closes.
func (p *panelState) close() {
	for _, tab := range p.tabs {
		tab.close()
	}
	p.tabs = nil
}

// panel is the session's panel, beside the conversation, or over it while
// there is too little room for both or it is maximized.
func (a *App) panel(
	c *ui.Context,
	s agent.Session,
	view *sessionView,
	covering bool,
	width float32,
) {
	p := components.PaletteOf(c.Theme())
	pn := &view.panel
	pn.typing = false
	a.sidePane(c, "panel", p.Background, covering, width, &a.Layout.Panel, func(under float32) {
		ui.Column(c).Fill().Padding(TitleBarHeight, 0, 0).Children(func() {
			tab := pn.shown()
			switch {
			case tab == nil:
				a.surfacePicker(c, s, view)
			case tab.term != nil:
				pn.typing = a.terminalView(c, tab)
			default:
				a.diffView(c, s, view, tab.diff)
			}
		})
		a.panelBar(c, view, covering, under)
	})
}

// panelBar is the panel's title bar: its tabs and the button that opens
// another at the left, and at the right the buttons that maximize and
// hide it.
func (a *App) panelBar(c *ui.Context, view *sessionView, covering bool, under float32) {
	pn := &view.panel
	left := float32(10)
	if covering {
		left = a.titleInset(c) - 6
	}
	ui.Row(c).
		Absolute().
		Top(0).
		Left(0).
		Right(0).
		Height(TitleBarHeight).
		Gap(4).
		Padding(0, 10, 0, left).
		AlignItems(ui.Center).
		Material(a.bar(under)).
		DragWindow().
		Children(func() {
			ui.Row(c).Gap(2).AlignItems(ui.Center).Shrink(1).MinWidth(0).Clip().Children(func() {
				for i, tab := range pn.tabs {
					a.panelTab(c.Key(fmt.Sprint("tab:", tab.id)), view, i, tab)
				}
			})
			ghost := components.ButtonStyle{
				Variant: components.Ghost,
				Size:    components.SizeIconSmall,
				Icon:    icons.Plus,
			}
			if components.Button(c, "", ghost).
				Label("New Tab").
				Tooltip("Open a terminal, the diff or a server").
				Shrink(0).
				Clicked() {
				pn.picking, pn.hosts = true, false
			}
			ui.Box(c).Grow(1).MinWidth(8)
			if !covering || pn.maximized {
				ghost.Icon = icons.Maximize2
				label := "Maximize Panel"
				if pn.maximized {
					ghost.Icon, label = icons.Minimize2, "Restore Panel"
				}
				if components.Button(c, "", ghost).
					Label(label).
					Tooltip(label).
					Shrink(0).
					Clicked() {
					pn.maximized = !pn.maximized
				}
			}
			a.panelToggle(c, view)
		})
}

// panelTab is a tab of the panel: what it shows and, while it is the one
// shown or the pointer is over it, the button that closes it.
func (a *App) panelTab(c *ui.Context, view *sessionView, i int, tab *surface) {
	p := components.PaletteOf(c.Theme())
	pn := &view.panel
	current := !pn.picking && i == pn.active
	row := ui.Row(c).
		Height(28).
		Radius(6).
		AlignItems(ui.Center).
		Shrink(1).
		MinWidth(0).
		Transition(components.ColorTransition)
	hovered := row.Hovered()
	switch {
	case current:
		row.Background(p.Accent)
	case hovered:
		row.Background(p.Accent.Alpha(0.5))
	}
	row.Children(func() {
		ink := p.MutedForeground
		if current {
			ink = p.Foreground
		}
		choose := ui.ButtonBase(c).
			Height(28).
			Padding(0, 4, 0, 8).
			Gap(6).
			AlignItems(ui.Center).
			Shrink(1).
			MinWidth(0).
			Radius(6).
			FocusRing(false).
			Label(tab.name())
		components.FocusRing(choose, p, 0)
		choose.Children(func() {
			ui.Icon(c, tab.icon()).FontSize(14).TextColor(ink).Shrink(0)
			ui.Text(c, tab.name()).
				TextColor(ink).
				FontWeight(500).
				SingleLine().
				Shrink(1).
				MaxWidth(160)
		})
		if choose.Clicked() {
			pn.active, pn.picking = i, false
			if tab.diff != nil {
				a.loadDiff(tab.diff)
			}
		}
		closer := ui.ButtonBase(c).
			Size(20, 20).
			Margin(0, 4, 0, 0).
			Center().
			Radius(4).
			Shrink(0).
			FocusRing(false).
			Label("Close " + tab.name())
		components.FocusRing(closer, p, 0)
		if closer.Hovered() {
			closer.Background(p.Accent)
		}
		if !current && !hovered && !closer.FocusVisible() {
			closer.Opacity(0)
		}
		closer.Children(func() {
			ui.Icon(c, icons.X).FontSize(12).TextColor(p.MutedForeground)
		})
		if closer.Clicked() {
			a.closeSurface(view, tab)
		}
	})
}

// panelToggle shows or hides the panel, in the window's top right corner
// either way: over the panel while it shows, else in the session's
// header.
func (a *App) panelToggle(c *ui.Context, view *sessionView) {
	p := components.PaletteOf(c.Theme())
	open := view.panelShown()
	label := "Show Panel"
	if open {
		label = "Hide Panel"
	}
	b := components.Button(c, "", components.ButtonStyle{
		Variant: components.Ghost,
		Size:    components.SizeIconSmall,
		Icon:    icons.PanelRight,
	}).
		Label(label).
		Tooltip(label + " (⌘J)").
		Shrink(0)
	if open {
		b.Background(p.Accent)
	}
	if b.Clicked() {
		a.togglePanel(view)
	}
}

// surfacePicker lists the surfaces the panel opens, each with the key
// that opens it while the list has the keys, as it has once shown.
func (a *App) surfacePicker(c *ui.Context, s agent.Session, view *sessionView) {
	if view.panel.hosts {
		a.hostPicker(c, view)
		return
	}
	p := components.PaletteOf(c.Theme())
	list := ui.Column(c.Key("picker")).
		Fill().
		Center().
		Padding(24).
		Focusable().
		FocusRing(false).
		AutoFocus().
		Label("Open a surface")
	for _, k := range surfaceKinds {
		if list.Shortcut(0, k.key) {
			a.openSurface(s, view, k.kind)
		}
	}
	if len(view.panel.tabs) > 0 && list.Shortcut(0, ui.KeyEscape) {
		view.panel.picking = false
	}
	list.Children(func() {
		ui.Column(c).Width(300).Gap(2).Children(func() {
			ui.Text(c, "Open a surface").
				FontWeight(500).
				TextAlign(ui.Center).
				Margin(0, 0, 12)
			for _, k := range surfaceKinds {
				row := ui.ButtonBase(c).
					Height(34).
					Padding(0, 8).
					Gap(10).
					Radius(6).
					AlignItems(ui.Center).
					FocusRing(false).
					Transition(components.ColorTransition).
					Label(k.name)
				if row.Hovered() {
					row.Background(p.Accent)
				}
				components.FocusRing(row, p, 0)
				row.Children(func() {
					ui.Icon(c, k.icon).FontSize(16).TextColor(p.MutedForeground).Shrink(0)
					ui.Text(c, k.name).Grow(1)
					components.Kbd(c, k.letter)
				})
				if row.Clicked() {
					a.openSurface(s, view, k.kind)
				}
			}
		})
	})
}

// hostPicker is the picker's second step for SSH: the servers of the ssh
// config under a search, Enter connecting to the first it finds, Esc going
// back to the surfaces.
func (a *App) hostPicker(c *ui.Context, view *sessionView) {
	t := c.Theme()
	p := components.PaletteOf(t)
	pn := &view.panel
	back := func() { pn.hosts, pn.hostSearch = false, "" }
	ui.Column(c.Key("hosts")).Fill().Center().Padding(24).Children(func() {
		ui.Column(c).Width(300).Gap(2).Children(func() {
			ui.Row(c).Gap(4).AlignItems(ui.Center).Margin(0, 0, 8).Children(func() {
				b := components.Button(c, "", components.ButtonStyle{
					Variant: components.Ghost,
					Size:    components.SizeIconExtraSmall,
					Icon:    icons.ChevronLeft,
				}).
					Label("Back to Surfaces").
					Tooltip("Back to Surfaces (Esc)").
					Shrink(0)
				if b.Clicked() {
					back()
				}
				ui.Text(c, "Connect to a server").FontWeight(500).Grow(1)
			})
			field := ui.Row(c).
				Height(32).
				Padding(0, 8).
				Gap(6).
				Radius(t.Radius).
				AlignItems(ui.Center).
				Border(1, p.Input).
				Margin(0, 0, 6).
				Shrink(0)
			field.Children(func() {
				ui.Icon(c, icons.Search).FontSize(14).TextColor(p.MutedForeground).Shrink(0)
				input := ui.TextInputBase(c.Key("host-search"), &pn.hostSearch).
					Placeholder("Search servers").
					Label("Search servers").
					Grow(1).
					MinWidth(0).
					AutoFocus().
					HandleInput(func(ev ui.InputEvent) bool {
						if ev.Kind == ui.InputKeyDown && ev.Key == ui.KeyEscape {
							back()
							return true
						}
						return false
					})
				if input.Focused() {
					field.Border(1, p.Ring)
				}
				if input.Submitted() {
					for _, sv := range a.servers.list {
						if matchesServer(sv, pn.hostSearch) {
							a.connect(sv)
							break
						}
					}
				}
			})
			ui.Scroll(c).MaxHeight(360).Children(func() {
				ui.Column(c).Gap(2).Children(func() {
					a.serverRows(c, pn.hostSearch)
				})
			})
		})
	})
}
