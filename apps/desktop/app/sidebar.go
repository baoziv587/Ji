package app

// The sidebar: the sessions by folder, the folder used last first, what
// each is doing, and the archived ones apart.

import (
	"fmt"
	"path/filepath"
	"time"

	"github.com/egoist/mygo/ui"

	"desktop/agent"
	"desktop/format"
	"desktop/ui/components"
	"desktop/ui/icons"
)

func (a *App) sidebar(c *ui.Context) {
	t := c.Theme()
	p := components.PaletteOf(t)
	// Over the window's material where it shows one, as a macOS sidebar,
	// veiled in the scheme's own: the material blends in the desktop
	// behind it, and a warm wallpaper would turn the panel warm
	background := p.Sidebar
	if a.seeThrough(c) {
		veil := glasses.sidebar
		if !t.Dark {
			veil = glasses.sidebarLight
		}
		background = p.Sidebar.Alpha(veil.at(a.Settings.Transparency))
	}
	ui.Column(c).Fill().Background(background).BorderWidth(0, 1, 0, 0).BorderColor(p.SidebarBorder).Children(func() {
		if a.settingsOpen {
			a.settingsNav(c)
		} else {
			a.sessionsNav(c)
		}

		ui.Row(c).Gap(6).Padding(8, 10, 10).Justify(ui.End).Children(func() {
			if a.ChooseFolder != nil {
				open := components.Button(c, "Open Folder…", components.ButtonStyle{Variant: components.Outline, Size: components.SizeSmall, Icon: icons.FolderOpen}).
					Tooltip("Start a session in another folder (⌘O)").Grow(1)
				if open.Clicked() {
					a.NewSessionInFolder()
				}
			}

			gear := components.Button(c, "", components.ButtonStyle{Variant: components.Ghost, Size: components.SizeIconSmall, Icon: icons.Settings}).
				Label("Settings").Tooltip("Settings (⌘,)")
			if a.settingsOpen {
				gear.Background(p.SidebarAccent)
			}
			if gear.Clicked() {
				if a.settingsOpen {
					a.settingsOpen = false
				} else {
					a.OpenSettings()
				}
			}
		})
	})
}

// sessionsNav is the sidebar's title bar, how the service is reached and
// a way to start a session, over the sessions by folder.
func (a *App) sessionsNav(c *ui.Context) {
	p := components.PaletteOf(c.Theme())
	a.sidebarBar(c, func() {
		dot := p.Destructive
		if a.link.up {
			dot = p.Success
		}
		ui.Box(c).Size(6, 6).Radius(3).Background(dot).Label("Connection").Tooltip(a.link.tooltip())
		ui.Text(c, "Sessions").FontWeight(600).Grow(1)
		if components.Button(c, "", components.ButtonStyle{Variant: components.Ghost, Size: components.SizeIconSmall, Icon: icons.Plus}).
			Label("New Session").Tooltip("New Session (⌘N)").Clicked() {
			a.NewSession("")
		}
	})

	groups := a.groups()
	chosen := a.selected
	if ui.Sidebar(c, &chosen, func() {
		for _, g := range groups.folders {
			a.section(c, g)
		}
		if len(groups.archived) > 0 {
			ui.SidebarSection(c, fmt.Sprintf("Archived (%d)", len(groups.archived)), &a.archivedOpen, func() {
				for _, i := range groups.archived {
					a.row(c, a.list.Sessions[i])
				}
			})
		}
	}).Background(ui.Transparent).Grow(1).Changed() {
		a.Select(chosen)
	}
}

// sidebarBar is the sidebar's part of the title bar, clear of the window
// controls, whose room ends at the zoom button's edge; in full screen,
// lined up with the items' text.
func (a *App) sidebarBar(c *ui.Context, fn func()) {
	bar := c.TitleBar()
	ui.Row(c).Height(TitleBarHeight).Shrink(0).Padding(0, 10, 0, max(bar.Left+16, 18)).Gap(8).AlignItems(ui.Center).DragWindow().Children(fn)
}

// chosen marks the sidebar's active item, focused or not, on the
// selection's color, which over the material lets a little of it through,
// as much in hue.
func (a *App) chosen(c *ui.Context, item ui.Element) {
	p := components.PaletteOf(c.Theme())
	tint := p.SidebarAccent
	if a.seeThrough(c) {
		tint = tint.Alpha(glasses.selection.at(a.Settings.Transparency))
	}
	item.Background(tint).TextColor(p.Foreground).FontWeight(500)
}

// grouping is the sessions as the sidebar shows them, by their index in
// the list: those not archived under their folders, the folder used last
// first, and the archived ones apart.
type grouping struct {
	folders  []group
	archived []int
}

// group is a folder's sessions, most recent first.
type group struct {
	root, title string
	sessions    []int
}

// groups is the grouping of the list, made again only once it changes.
func (a *App) groups() *grouping {
	if a.grouped == nil {
		a.grouped = groupSessions(a.list.Sessions)
	}
	return a.grouped
}

// regroup is to be called whenever the list changes.
func (a *App) regroup() { a.grouped = nil }

func groupSessions(sessions []agent.Session) *grouping {
	g := &grouping{}
	at := map[string]int{}
	for i, s := range sessions {
		if s.Archived {
			g.archived = append(g.archived, i)
			continue
		}
		f, ok := at[s.Root]
		if !ok {
			f = len(g.folders)
			at[s.Root] = f
			g.folders = append(g.folders, group{root: s.Root, title: filepath.Base(s.Root)})
		}
		g.folders[f].sessions = append(g.folders[f].sessions, i)
	}

	// Two folders of one name tell themselves apart by their parents
	names := map[string]int{}
	for _, f := range g.folders {
		names[f.title]++
	}
	for i, f := range g.folders {
		if names[f.title] > 1 {
			g.folders[i].title = f.title + " · " + filepath.Base(filepath.Dir(f.root))
		}
	}
	return g
}

func (a *App) section(c *ui.Context, g group) {
	open := a.opened[g.root]
	if open == nil {
		open = new(bool)
		*open = true
		a.opened[g.root] = open
	}
	ui.SidebarSection(c.Key("section:"+g.root), g.title, open, func() {
		for _, i := range g.sessions {
			a.row(c, a.list.Sessions[i])
		}
	}).Tooltip(g.root)
}

func (a *App) row(c *ui.Context, s agent.Session) {
	t := c.Theme()
	p := components.PaletteOf(t)
	status := a.status(s)
	item := ui.SidebarItem(c.Key(s.ID), s.ID, nil, titleOf(s)).Height(32).Padding(0, 8).Transition(components.ColorTransition)
	if s.ID == a.selected {
		a.chosen(c, item)
	}
	item.Children(func() {
		switch status {
		case "asking":
			components.Tag(c, "Approval", p.Waiting)
		case "running":
			components.Spinner(c, "Running", 16, p.Primary)
		case "failed":
			components.Tag(c, "Failed", p.Destructive)
		default:
			ui.Text(c, format.Ago(s.Updated, time.Now())).FontSize(components.TextXS(t)).FontWeight(500).TextColor(p.MutedForeground).FontFeatures("tnum")
		}
	})
	item.ContextMenu(func(m *ui.Menu) {
		if m.Item("New Session in This Folder").Chosen() {
			a.NewSession(s.Root)
		}
		m.Separator()
		if s.Archived {
			if m.Item("Unarchive").Chosen() {
				a.unarchive(s.ID)
			}
		} else if m.Item("Archive").Disabled(status == "running" || status == "asking").Chosen() {
			a.archive(s.ID, true)
		}
	})
}

// status is what a session is doing: the live state of one the window
// follows, the list's otherwise.
func (a *App) status(s agent.Session) string {
	view := a.views[s.ID]
	if view == nil || view.t.State.ID == "" {
		return s.Status
	}
	st := view.t.State
	switch {
	case len(st.Asking) > 0 || view.t.Asking != nil:
		return "asking"
	case st.Replying:
		return "running"
	case st.Outcome == "failed":
		return "failed"
	}
	return "idle"
}

// titleOf is a session's title, or what stands for one before its first
// message.
func titleOf(s agent.Session) string {
	if s.Title == "" {
		return "New Session"
	}
	return s.Title
}
