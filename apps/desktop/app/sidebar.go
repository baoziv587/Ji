package app

// The sidebar: a search over the sessions, those the person pinned first,
// the rest under their folders, and the archived ones settled at the
// bottom.

import (
	"fmt"
	"path/filepath"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

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
	ui.Column(c).
		Fill().
		Background(background).
		BorderWidth(0, 1, 0, 0).
		BorderColor(p.SidebarBorder).
		Children(func() {
			if a.settingsOpen {
				a.settingsNav(c)
			} else {
				a.sessionsNav(c)
			}

			ui.Row(c).Gap(6).Padding(4, 10, 10).AlignItems(ui.Center).Children(func() {
				gearStyle := components.ButtonStyle{
					Variant: components.Ghost,
					Size:    components.SizeIconSmall,
					Icon:    icons.Settings,
				}
				gear := components.Button(c, "", gearStyle).
					Label("Settings").
					Tooltip("Settings (⌘,)")
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
				ui.Box(c).Grow(1)
				dot := p.Destructive
				if a.link.up {
					dot = p.Success
				}
				ui.Box(c).
					Size(6, 6).
					Margin(0, 10, 0, 0).
					Radius(3).
					Background(dot).
					Label("Connection").
					Tooltip(a.link.tooltip())
			})
		})
}

// sessionsNav is the sidebar's title bar and search over the sessions: those
// the search finds, or the pinned ones and the folders, with the archived
// ones settled under them.
func (a *App) sessionsNav(c *ui.Context) {
	a.sidebarBar(c, func() { a.sidebarToggle(c) })
	a.searchRow(c)

	groups := a.groups()
	chosen := a.selected
	if ui.Sidebar(c, &chosen, func() {
		if a.search != "" {
			a.searchResults(c)
			return
		}
		for _, i := range groups.pinned {
			a.recentRow(c.Key("pinned:"+a.list.Sessions[i].ID), a.list.Sessions[i])
		}
		if len(groups.pinned) > 0 && len(groups.folders) > 0 {
			ui.Box(c).Height(8).Shrink(0)
		}
		for _, g := range groups.folders {
			a.project(c.Key("project:"+g.root), g)
		}
	}).Background(ui.Transparent).Grow(1).Changed() {
		a.Select(chosen)
	}
	if a.search == "" {
		a.settled(c, groups.archived)
	}
}

// sidebarBar is the sidebar's part of the title bar, clear of the window
// controls, whose room ends at the zoom button's edge; in full screen,
// lined up with the items' text.
func (a *App) sidebarBar(c *ui.Context, fn func()) {
	bar := c.TitleBar()
	ui.Row(c).
		Height(TitleBarHeight).
		Shrink(0).
		Padding(0, 10, 0, max(bar.Left+12, 14)).
		Gap(8).
		AlignItems(ui.Center).
		DragWindow().
		Children(fn)
}

// sidebarToggle hides the sidebar, or shows it again from the session's
// title bar.
func (a *App) sidebarToggle(c *ui.Context) {
	label := "Hide Sidebar"
	if a.Layout.SidebarHidden {
		label = "Show Sidebar"
	}
	toggle := components.Button(c, "", components.ButtonStyle{
		Variant: components.Ghost,
		Size:    components.SizeIconExtraSmall,
		Icon:    icons.PanelLeft,
	}).
		Label(label).
		Tooltip(label).
		Shrink(0)
	if toggle.Clicked() {
		a.Layout.SidebarHidden = !a.Layout.SidebarHidden
	}
}

// searchRow is the search over the sessions' titles and folders (⌘F), with
// the buttons that start one beside it.
func (a *App) searchRow(c *ui.Context) {
	t := c.Theme()
	p := components.PaletteOf(t)
	if c.Shortcut(ui.Cmd, ui.KeyF) {
		a.focusSearch = true
	}
	ui.Row(c).Padding(0, 10, 6).Gap(2).AlignItems(ui.Center).Shrink(0).Children(func() {
		field := ui.Row(c).
			Height(28).
			Padding(0, 8).
			Gap(6).
			Radius(t.Radius).
			AlignItems(ui.Center).
			Grow(1).
			MinWidth(0).
			Border(1, ui.Transparent).
			Transition(components.ColorTransition)
		var input ui.Element
		field.Children(func() {
			ui.Icon(c, icons.Search).FontSize(14).TextColor(p.MutedForeground).Shrink(0)
			input = ui.TextInputBase(c.Key("search"), &a.search).
				Placeholder("Search").
				Label("Search sessions").
				Grow(1).
				MinWidth(0).
				HandleInput(func(ev ui.InputEvent) bool {
					if ev.Kind == ui.InputKeyDown && ev.Key == ui.KeyEscape && a.search != "" {
						a.search = ""
						return true
					}
					return false
				})
		})
		if a.focusSearch {
			a.focusSearch = false
			input.Focus()
		}
		switch {
		case input.Focused():
			field.Background(p.Card).Border(1, p.Ring)
		case field.Hovered():
			field.Background(p.Accent.Alpha(0.6))
		}

		icon := func(svg *ui.SVG, label, tip string) bool {
			return components.Button(c, "", components.ButtonStyle{
				Variant: components.Ghost,
				Size:    components.SizeIconSmall,
				Icon:    svg,
			}).
				Label(label).
				Tooltip(tip).
				Shrink(0).
				Clicked()
		}
		if a.ChooseFolder != nil &&
			icon(icons.FolderPlus, "Open Folder…", "Start a session in another folder (⌘O)") {
			a.NewSessionInFolder()
		}
		if icon(icons.SquarePen, "New Session", "New Session (⌘N)") {
			a.NewSession("")
		}
	})
}

// searchResults is the sessions the search finds, archived ones last.
func (a *App) searchResults(c *ui.Context) {
	p := components.PaletteOf(c.Theme())
	found := a.matches()
	if len(found) == 0 {
		ui.Text(c, "No sessions match").TextColor(p.MutedForeground).Padding(8)
		return
	}
	for _, i := range found {
		s := a.list.Sessions[i]
		a.recentRow(c.Key("found:"+s.ID), s)
	}
}

// settled is the archived sessions, under a head at the sidebar's foot that
// opens them over the folders.
func (a *App) settled(c *ui.Context, archived []int) {
	if len(archived) == 0 {
		return
	}
	ui.Column(c).Padding(0, 10).Shrink(0).Children(func() {
		a.foldHead(c, foldHeadProps{
			title: "Settled",
			label: fmt.Sprintf("Settled (%d)", len(archived)),
			tip:   "Sessions put away; nothing is deleted",
			count: len(archived),
			open:  &a.archivedOpen,
		})
		if !a.archivedOpen {
			return
		}
		chosen := a.selected
		if ui.Sidebar(c.Key("settled"), &chosen, func() {
			for _, i := range archived {
				a.row(c, a.list.Sessions[i])
			}
		}).
			Background(ui.Transparent).
			Padding(2, 0).
			MaxHeight(280).
			Changed() {
			a.Select(chosen)
		}
	})
}

// project is a folder's sessions, folded under a head with its count.
func (a *App) project(c *ui.Context, g group) {
	open := a.opened[g.root]
	if open == nil {
		open = new(bool)
		*open = true
		a.opened[g.root] = open
	}
	// Folded, it still says when one of its sessions needs an eye
	status := ""
	if !*open {
		status = a.mostPressing(g.sessions)
	}
	missing := a.firstPresent(g.folders) == ""
	ui.Column(c).Gap(2).Shrink(0).Children(func() {
		head := a.foldHead(c, foldHeadProps{
			mark:    g.title,
			title:   g.title,
			label:   fmt.Sprintf("%s (%d)", g.title, len(g.sessions)),
			tip:     strings.Join(g.folders, "\n"),
			count:   len(g.sessions),
			open:    open,
			status:  status,
			missing: missing,
		})
		head.ContextMenu(func(m *ui.Menu) {
			if m.Item("New Session").Disabled(missing).Chosen() {
				a.NewSession(a.liveFolder(g.root))
			}
			if m.Item("Edit Project…").Chosen() {
				a.EditProject(g.root)
			}
		})
		if *open {
			for _, i := range g.sessions {
				a.row(c, a.list.Sessions[i])
			}
		}
	})
}

type foldHeadProps struct {
	// mark is the name the monogram is of, none when empty.
	mark, title, label, tip string
	count                   int
	open                    *bool
	// status is shown while folded: what one of the group's sessions does
	// that needs an eye on it.
	status string
	// missing marks a project none of whose folders is there any more.
	missing bool
}

// foldHead is the head of a group of sessions that a click opens and
// closes: its name, how many it holds, and a chevron that turns as it opens.
func (a *App) foldHead(c *ui.Context, f foldHeadProps) ui.Element {
	t := c.Theme()
	p := components.PaletteOf(t)
	head := ui.ButtonBase(c).
		Height(32).
		Padding(0, 8).
		Gap(8).
		Radius(t.Radius).
		AlignItems(ui.Center).
		Shrink(0).
		FocusRing(false).
		Transition(components.ColorTransition).
		Label(f.label).
		Tooltip(f.tip)
	if head.Hovered() {
		head.Background(p.Accent.Alpha(0.6))
	}
	components.FocusRing(head, p, 1)
	head.Children(func() {
		if f.mark != "" {
			monogram(c, f.mark)
		}
		ui.Text(c, f.title).SingleLine().Shrink(1).Grow(1)
		if f.missing {
			components.Tag(c, "Missing", p.Destructive).
				Tooltip("The folder was moved, renamed or deleted: Edit Project… to find it")
		}
		if !*f.open {
			statusMark(c, p, f.status)
		}
		ui.Text(c, fmt.Sprint(f.count)).
			FontSize(components.TextXS(t)).
			TextColor(p.MutedForeground).
			FontFeatures("tnum").
			Shrink(0)
		turn := float32(0)
		if *f.open {
			turn = 90
		}
		ui.Icon(c, icons.ChevronRight).
			FontSize(14).
			TextColor(p.MutedForeground.Alpha(0.7)).
			Rotate(turn).
			Shrink(0)
	})
	if head.Clicked() {
		*f.open = !*f.open
	}
	return head
}

// monogram is a folder's first letter on a small tile, the same in every
// scheme: a folder is told by its name, not a color.
func monogram(c *ui.Context, name string) ui.Element {
	t := c.Theme()
	p := components.PaletteOf(t)
	r, _ := utf8.DecodeRuneInString(name)
	return ui.Column(c).
		Size(16, 16).
		Radius(4).
		Background(p.Secondary).
		Center().
		Shrink(0).
		Children(func() {
			ui.Text(c, strings.ToUpper(string(r))).
				FontSize(components.TextXS(t) - 1).
				FontWeight(600).
				TextColor(p.MutedForeground)
		})
}

// recentRow is a session on three lines, as it shows outside its folder,
// pinned or found: the folder and when it changed, its title and what it
// does, the branch.
func (a *App) recentRow(c *ui.Context, s agent.Session) {
	t := c.Theme()
	p := components.PaletteOf(t)
	status := a.status(s)
	item := ui.SidebarItem(c, s.ID, nil, "").
		Label(titleOf(s)).
		Padding(8, 8).
		Gap(0).
		Transition(components.ColorTransition)
	if s.ID == a.selected {
		a.chosen(c, item)
	}
	small := func(text string) ui.Element {
		return ui.Text(c, text).
			FontSize(components.TextXS(t)).
			TextColor(p.MutedForeground).
			SingleLine()
	}
	item.Children(func() {
		// Wins all the room from the empty label before it
		ui.Column(c).Grow(1000).MinWidth(0).Gap(4).Children(func() {
			ui.Row(c).Gap(6).AlignItems(ui.Center).Children(func() {
				folder := a.folderTitle(s.Root)
				monogram(c, folder)
				if a.isPinned(s.ID) && !s.Archived {
					ui.Icon(c, icons.Pin).
						FontSize(11).
						TextColor(p.MutedForeground).
						Label("Pinned").
						Shrink(0)
				}
				small(folder).FontWeight(500).Shrink(1).Grow(1)
				small(format.Ago(s.Updated, time.Now())).FontFeatures("tnum").Shrink(0)
			})
			ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
				ui.Text(c, titleOf(s)).FontWeight(500).SingleLine().Shrink(1).Grow(1)
				statusMark(c, p, status)
			})
			if branch := a.branches[s.Root]; branch != "" {
				metaLine(c, icons.GitBranch, branch)
			}
		})
	})
	item.ContextMenu(a.rowMenu(s, status))
}

// row is a session on one line, under its folder or settled.
func (a *App) row(c *ui.Context, s agent.Session) {
	t := c.Theme()
	p := components.PaletteOf(t)
	status := a.status(s)
	item := ui.SidebarItem(c.Key(s.ID), s.ID, nil, titleOf(s)).
		Height(32).
		Padding(0, 8, 0, 32).
		Transition(components.ColorTransition)
	if s.Archived {
		item.Padding(0, 8)
	}
	if s.ID == a.selected {
		a.chosen(c, item)
	}
	item.Children(func() {
		if !statusMark(c, p, status) {
			ui.Text(c, format.Ago(s.Updated, time.Now())).
				FontSize(components.TextXS(t)).
				FontWeight(500).
				TextColor(p.MutedForeground).
				FontFeatures("tnum")
		}
	})
	item.ContextMenu(a.rowMenu(s, status))
}

// metaLine is a quiet fact about a session, after its glyph: the folder
// or the branch.
func metaLine(c *ui.Context, icon *ui.SVG, text string) ui.Element {
	t := c.Theme()
	p := components.PaletteOf(t)
	return ui.Row(c).Gap(4).AlignItems(ui.Center).Children(func() {
		ui.Icon(c, icon).FontSize(12).TextColor(p.MutedForeground).Shrink(0)
		ui.Text(c, text).
			FontSize(components.TextXS(t)).
			TextColor(p.MutedForeground).
			SingleLine().
			Shrink(1)
	})
}

// statusMark marks what a session does that needs an eye on it, and is
// whether there was any.
func statusMark(c *ui.Context, p *components.Palette, status string) bool {
	switch status {
	case "asking":
		components.Tag(c, "Approval", p.Waiting)
	case "running":
		components.Spinner(c, "Running", 16, p.Primary)
	case "failed":
		components.Tag(c, "Failed", p.Destructive)
	default:
		return false
	}
	return true
}

func (a *App) rowMenu(s agent.Session, status string) func(m *ui.Menu) {
	return func(m *ui.Menu) {
		if !s.Archived {
			if a.isPinned(s.ID) {
				if m.Item("Unpin").Chosen() {
					a.pin(s.ID, false)
				}
			} else if m.Item("Pin").Chosen() {
				a.pin(s.ID, true)
			}
		}
		live := a.liveFolder(s.Root)
		if m.Item("New Session in This Project").Disabled(live == "").Chosen() {
			a.NewSession(live)
		}
		if m.Item("Edit Project…").Chosen() {
			a.EditProject(a.groupKeyOf(s.Root))
		}
		m.Separator()
		if s.Archived {
			if m.Item("Reopen").Chosen() {
				a.unarchive(s.ID)
			}
		} else if m.Item("Settle").Disabled(isBusy(status)).Chosen() {
			a.archive(s.ID, true)
		}
	}
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
// the list: the pinned ones, the rest not archived under their projects,
// the one used last first, and the archived ones apart.
type grouping struct {
	pinned   []int
	folders  []group
	archived []int
	// titles is the name of each folder's project as shown, by its path.
	titles map[string]string
}

// group is a project's sessions, most recent first: the folders of one the
// person set, or a folder in none. Its root, the first folder, keys it.
type group struct {
	root, title string
	folders     []string
	sessions    []int
}

// groups is the grouping of the list, made again only once it changes.
func (a *App) groups() *grouping {
	if a.grouped == nil {
		a.grouped = groupSessions(a.list.Sessions, a.pinned, a.Pins, a.Projects)
	}
	return a.grouped
}

// regroup is to be called whenever the list or the projects change.
func (a *App) regroup() {
	a.grouped = nil
	a.found = nil
}

// folderTitle is how the sidebar names a folder: by its project.
func (a *App) folderTitle(root string) string {
	if title, ok := a.groups().titles[root]; ok {
		return title
	}
	return groupOf(a.Projects, root).title
}

// groupOf is the group root's sessions are in: its project's, or its own
// when it is in none.
func groupOf(projects []Project, root string) group {
	if i := projectOf(projects, root); i >= 0 {
		p := projects[i]
		return group{root: p.Folders[0], title: p.title(), folders: p.Folders}
	}
	return group{root: root, title: filepath.Base(root), folders: []string{root}}
}

func groupSessions(
	sessions []agent.Session,
	pinned string,
	pins []string,
	projects []Project,
) *grouping {
	g := &grouping{titles: map[string]string{}}
	at := map[string]int{}
	add := func(root string) int {
		next := groupOf(projects, root)
		f, ok := at[next.root]
		if !ok {
			f = len(g.folders)
			at[next.root] = f
			g.folders = append(g.folders, next)
		}
		return f
	}
	if slices.ContainsFunc(sessions, func(s agent.Session) bool {
		return s.Root == pinned && !s.Archived && !slices.Contains(pins, s.ID)
	}) {
		add(pinned)
	}
	for i, s := range sessions {
		if s.Archived {
			g.archived = append(g.archived, i)
			continue
		}
		if slices.Contains(pins, s.ID) {
			g.pinned = append(g.pinned, i)
			continue
		}
		f := add(s.Root)
		g.folders[f].sessions = append(g.folders[f].sessions, i)
	}

	// Two of one name tell themselves apart by their first folders' parents
	names := map[string]int{}
	for _, f := range g.folders {
		names[f.title]++
	}
	for i, f := range g.folders {
		if names[f.title] > 1 {
			g.folders[i].title = f.title + " · " + filepath.Base(filepath.Dir(f.root))
		}
	}
	for _, s := range sessions {
		own := groupOf(projects, s.Root)
		if f, ok := at[own.root]; ok {
			g.titles[s.Root] = g.folders[f].title
		} else {
			g.titles[s.Root] = own.title
		}
	}
	return g
}

// found is the sessions a search matched, by their index in the list.
type found struct {
	query    string
	sessions []int
}

// matches is the sessions whose title or folder holds the search, those not
// archived first, found again only as the search or the list changes.
func (a *App) matches() []int {
	query := strings.ToLower(strings.TrimSpace(a.search))
	if a.found != nil && a.found.query == query {
		return a.found.sessions
	}
	f := &found{query: query}
	var archived []int
	for i, s := range a.list.Sessions {
		if !strings.Contains(strings.ToLower(titleOf(s)), query) &&
			!strings.Contains(strings.ToLower(filepath.Base(s.Root)), query) {
			continue
		}
		if s.Archived {
			archived = append(archived, i)
		} else {
			f.sessions = append(f.sessions, i)
		}
	}
	f.sessions = append(f.sessions, archived...)
	a.found = f
	return f.sessions
}

// mostPressing is what of the sessions' doing most needs an eye on it: an
// approval, then a failure, then a reply under way; "" when none does.
func (a *App) mostPressing(sessions []int) string {
	rank := map[string]int{"asking": 3, "failed": 2, "running": 1}
	most := ""
	for _, i := range sessions {
		if status := a.status(a.list.Sessions[i]); rank[status] > rank[most] {
			most = status
		}
	}
	return most
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
