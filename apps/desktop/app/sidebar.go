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
	// Over the window's material where it shows one, as a macOS sidebar
	vibrant := a.vibrant(c)
	background := p.Sidebar
	if vibrant {
		background = ui.Transparent
	}
	ui.Column(c).Fill().Background(background).BorderWidth(0, 1, 0, 0).BorderColor(p.SidebarBorder).Children(func() {
		// Under the window controls, then lined up with the items' text
		bar := c.TitleBar()
		ui.Row(c).Height(TitleBarHeight).Shrink(0).Padding(0, 10, 0, max(bar.Left, 18)).Gap(8).AlignItems(ui.Center).DragWindow().Children(func() {
			dot := p.Destructive
			if a.connected {
				dot = p.Success
			}
			ui.Box(c).Size(6, 6).Radius(3).Background(dot).Label("Connection").
				Tooltip(map[bool]string{true: "Connected to the agent", false: "Not connected to the agent"}[a.connected])
			ui.Text(c, "Sessions").FontWeight(600).Grow(1)
			if components.Button(c, "", components.ButtonStyle{Variant: components.Ghost, Size: components.SizeIconSmall, Icon: icons.Plus}).
				Label("New Session").Tooltip("New Session (⌘N)").Clicked() {
				a.NewSession("")
			}
		})

		groups, archived := a.groups()
		// None is chosen while the settings show, so that choosing any shows it
		chosen := a.selected
		if a.settingsOpen {
			chosen = ""
		}
		if ui.Sidebar(c, &chosen, func() {
			for _, g := range groups {
				a.section(c, g)
			}
			if len(archived) > 0 {
				ui.SidebarSection(c, fmt.Sprintf("Archived (%d)", len(archived)), &a.archivedOpen, func() {
					for _, s := range archived {
						a.row(c, s)
					}
				})
			}
		}).Background(background).Grow(1).Changed() {
			a.Select(chosen)
		}

		ui.Row(c).Gap(6).Padding(8, 10, 10).Justify(ui.End).Children(func() {
			if a.ChooseFolder != nil && components.Button(c, "Open Folder…", components.ButtonStyle{Variant: components.Outline, Size: components.SizeSmall, Icon: icons.FolderOpen}).
				Tooltip("Start a session in another folder (⌘O)").Grow(1).Clicked() {
				a.NewSessionInFolder()
			}
			gear := components.Button(c, "", components.ButtonStyle{Variant: components.Ghost, Size: components.SizeIconSmall, Icon: icons.Settings}).
				Label("Settings").Tooltip("Settings (⌘,)")
			if a.settingsOpen {
				gear.Background(p.SidebarAccent)
			}
			if gear.Clicked() {
				a.settingsOpen = !a.settingsOpen
			}
		})
	})
}

// group is a folder's sessions, most recent first.
type group struct {
	root, title string
	sessions    []agent.Session
}

// groups puts the sessions not archived under their folders, the folder
// used last first, and the archived ones apart.
func (a *App) groups() ([]group, []agent.Session) {
	var groups []group
	at := map[string]int{}
	var archived []agent.Session
	for _, s := range a.list.Sessions {
		if s.Archived {
			archived = append(archived, s)
			continue
		}
		i, ok := at[s.Root]
		if !ok {
			i = len(groups)
			at[s.Root] = i
			groups = append(groups, group{root: s.Root, title: filepath.Base(s.Root)})
		}
		groups[i].sessions = append(groups[i].sessions, s)
	}
	// Two folders of one name tell themselves apart by their parents
	names := map[string]int{}
	for _, g := range groups {
		names[g.title]++
	}
	for i, g := range groups {
		if names[g.title] > 1 {
			groups[i].title = g.title + " · " + filepath.Base(filepath.Dir(g.root))
		}
	}
	return groups, archived
}

func (a *App) section(c *ui.Context, g group) {
	open := a.opened[g.root]
	if open == nil {
		open = new(bool)
		*open = true
		a.opened[g.root] = open
	}
	ui.SidebarSection(c.Key("section:"+g.root), g.title, open, func() {
		for _, s := range g.sessions {
			a.row(c, s)
		}
	}).Tooltip(g.root)
}

func (a *App) row(c *ui.Context, s agent.Session) {
	t := c.Theme()
	p := components.PaletteOf(t)
	status := a.status(s)
	item := ui.SidebarItem(c.Key(s.ID), s.ID, nil, titleOf(s)).Height(32).Padding(0, 8).Transition(components.ColorTransition)
	if s.ID == a.selected && !a.settingsOpen {
		// The active item, focused or not, on the selection's tint; over the
		// material, a tint of the brand that lets it show through
		tint := p.SidebarAccent
		if a.vibrant(c) {
			tint = p.Primary.Alpha(0.16)
		}
		item.Background(tint).TextColor(p.Foreground).FontWeight(500)
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
