package app

// Projects: a name over the folders whose sessions the sidebar groups
// together, kept by the window alone: the service knows only each session's
// folder. A folder renamed or moved is added where it is now; on saving,
// the sessions of the gone one are given it, and go on there, their history
// kept.

import (
	"context"
	"fmt"
	"path/filepath"
	"slices"
	"strings"

	"github.com/egoist/mygo/ui"

	"desktop/agent"
	"desktop/format"
	"desktop/ui/components"
	"desktop/ui/icons"
)

// Project is a name over folders, as the person set them; a folder in none
// is a project of its own, named by it.
type Project struct {
	Name    string   `json:"name,omitempty"`
	Folders []string `json:"folders"`
}

// title is the project's name, or its first folder's.
func (p Project) title() string {
	if p.Name != "" {
		return p.Name
	}
	if len(p.Folders) == 0 {
		return ""
	}
	return filepath.Base(p.Folders[0])
}

// projectOf is the project holding folder, -1 for none.
func projectOf(projects []Project, folder string) int {
	return slices.IndexFunc(
		projects,
		func(p Project) bool { return slices.Contains(p.Folders, folder) },
	)
}

// foldersOf is the folders of the project root is in: root alone when in none.
func (a *App) foldersOf(root string) []string { return groupOf(a.Projects, root).folders }

// isMissing is whether root was found gone the last time it was looked for.
func (a *App) isMissing(root string) bool { return a.missing[root] }

// liveFolder is where a new session of root's project starts: its first
// folder still there, "" when none is.
func (a *App) liveFolder(root string) string { return a.firstPresent(a.foldersOf(root)) }

// firstPresent is the first of folders still there, "" when none is.
func (a *App) firstPresent(folders []string) string {
	for _, folder := range folders {
		if !a.isMissing(folder) {
			return folder
		}
	}
	return ""
}

// projectEdit is the Edit project dialog's draft of a sidebar group.
type projectEdit struct {
	open bool
	// key is the group's, the project's index in the projects, -1 for a
	// folder in none, and what the draft started from.
	key     string
	index   int
	from    Project
	name    string
	folders []string
	// moves is the project each folder added leaves, by folder.
	moves map[string]string
	// removing is whether the removal waits for a second click.
	removing bool
}

// EditProject opens the dialog on the group of the sidebar whose key is
// given, its first folder.
func (a *App) EditProject(key string) {
	g := groupOf(a.Projects, key)
	from := Project{Name: g.title, Folders: g.folders}
	a.editing = projectEdit{
		open:    true,
		key:     key,
		index:   projectOf(a.Projects, key),
		from:    from,
		name:    from.Name,
		folders: slices.Clone(from.Folders),
		moves:   map[string]string{},
	}
	a.readFolders(from.Folders...)
}

// addFolder asks for a folder to add to the draft.
func (a *App) addFolder() {
	if a.ChooseFolder == nil {
		return
	}
	a.async(func() {
		folder, err := a.ChooseFolder()
		a.update(func() {
			switch {
			case err != nil:
				a.toast = &toast{message: "Could not choose a folder: " + err.Error()}
			case folder != "":
				a.draftFolder(folder)
			}
		})
	})
}

// draftFolder adds folder to the draft once, noting the project it leaves.
func (a *App) draftFolder(folder string) {
	e := &a.editing
	if slices.Contains(e.folders, folder) {
		return
	}
	e.folders = append(e.folders, folder)
	if i := projectOf(a.Projects, folder); i >= 0 && i != e.index {
		e.moves[folder] = a.Projects[i].title()
	} else if i < 0 && a.groupKeyOf(folder) != e.key && a.hasSessionsIn(folder) {
		e.moves[folder] = filepath.Base(folder)
	}
	a.readFolders(folder)
}

func (a *App) dropFolder(folder string) {
	e := &a.editing
	if len(e.folders) <= 1 {
		return
	}
	e.folders = slices.DeleteFunc(e.folders, func(f string) bool { return f == folder })
	delete(e.moves, folder)
}

// savable is whether saving does anything: the draft changed, or a gone
// folder's sessions can go on in one still there.
func (e *projectEdit) savable(a *App) bool {
	canMove := a.firstPresent(e.folders) != "" && slices.ContainsFunc(e.folders, a.isMissing)
	return e.edited() || canMove
}

// edited is whether the draft differs from what it started from.
func (e *projectEdit) edited() bool {
	return e.name != e.from.Name || !slices.Equal(e.folders, e.from.Folders)
}

// saveProject keeps the draft: its folders leave the projects they were
// in, and those left with none go.
func (a *App) saveProject() {
	e := &a.editing
	if len(e.folders) == 0 {
		return
	}
	name := e.name
	if name == filepath.Base(e.folders[0]) {
		name = ""
	}
	edited := Project{Name: name, Folders: slices.Clone(e.folders)}

	var projects []Project
	for i, p := range a.Projects {
		if i == e.index {
			continue
		}
		p.Folders = slices.DeleteFunc(slices.Clone(p.Folders), func(f string) bool {
			return slices.Contains(edited.Folders, f)
		})
		if len(p.Folders) > 0 {
			projects = append(projects, p)
		}
	}
	if e.index >= 0 {
		projects = slices.Insert(projects, min(e.index, len(projects)), edited)
	} else {
		projects = append(projects, edited)
	}

	if open := a.opened[e.key]; open != nil {
		a.opened[edited.Folders[0]] = open
	}
	a.setProjects(projects)
	a.readFolders(edited.Folders...)
	e.open = false

	present := func(f string) bool { return !a.isMissing(f) }
	gone := slices.DeleteFunc(slices.Clone(edited.Folders), present)
	if live := a.firstPresent(edited.Folders); live != "" && len(gone) > 0 {
		a.moveFolders(gone, live)
	}
}

// moveFolders gives each session whose folder is gone the folder it went
// to, worked out from live: the sessions go on there, and the projects keep
// their folders where they are now.
func (a *App) moveFolders(gone []string, live string) {
	isDir := a.isDir
	sessions := slices.Clone(a.list.Sessions)
	busy := map[string]bool{}
	for _, s := range sessions {
		busy[s.ID] = isBusy(a.status(s))
	}
	a.request(func(ctx context.Context) {
		var moves []folderMove
		for _, folder := range gone {
			from, to := moveOf(folder, live, isDir)
			moves = append(moves, folderMove{from, to})
		}
		var moved []agent.Session
		var failed error
		for _, s := range sessions {
			if busy[s.ID] || isDir(s.Root) {
				continue
			}
			root, ok := applyMoves(moves, s.Root)
			if !ok || !isDir(root) {
				continue
			}
			next, err := a.agent.SetRoot(ctx, s.ID, root)
			if err != nil {
				failed = err
				continue
			}
			moved = append(moved, next)
		}
		a.update(func() {
			a.moved(moves, live, moved)
			if failed != nil {
				a.toast = &toast{message: "Could not move every session: " + failed.Error()}
			}
		})
	})
}

// moved takes in the sessions given their folders, following them again
// where they work now, and moves the projects' folders the same way.
func (a *App) moved(moves []folderMove, live string, sessions []agent.Session) {
	shown := false
	roots := []string{live}
	for _, s := range sessions {
		a.replace(s)
		a.close(s.ID)
		shown = shown || s.ID == a.selected
		roots = append(roots, s.Root)
	}
	if shown {
		a.show(a.selected)
	}

	projects := slices.Clone(a.Projects)
	changed := false
	for i, p := range projects {
		var folders []string
		for _, folder := range p.Folders {
			if to, ok := applyMoves(moves, folder); ok {
				folder = to
			}
			if !slices.Contains(folders, folder) {
				folders = append(folders, folder)
			}
		}
		if slices.Equal(folders, p.Folders) {
			continue
		}
		changed = true
		if folders[0] != p.Folders[0] {
			// Named as the dialog showed it
			projects[i].Name = p.title()
			if open := a.opened[p.Folders[0]]; open != nil {
				a.opened[folders[0]] = open
			}
		}
		projects[i].Folders = folders
	}
	if changed {
		a.setProjects(projects)
	}
	a.readFolders(roots...)
	if len(sessions) > 0 {
		a.toast = &toast{
			message: fmt.Sprintf(
				"%s now go on in %s",
				sessionsCount(len(sessions)),
				format.ShortPath(live),
			),
		}
	}
}

// folderMove is a folder renamed or moved: where it was, and where it is.
type folderMove struct{ from, to string }

// applyMoves is where path is now, by the first move of a folder holding it.
func applyMoves(moves []folderMove, path string) (string, bool) {
	for _, m := range moves {
		rest, err := filepath.Rel(m.from, path)
		if err != nil || rest == ".." || strings.HasPrefix(rest, ".."+string(filepath.Separator)) {
			continue
		}
		return filepath.Join(m.to, rest), true
	}
	return path, false
}

// moveOf is the move that took gone to where live is: the folder renamed
// in its place above both, when their names agree up to it and gone's
// parents are gone too; else gone itself.
func moveOf(gone, live string, isDir func(string) bool) (from, to string) {
	from, to = gone, live
	for filepath.Base(from) == filepath.Base(to) {
		up, down := filepath.Dir(from), filepath.Dir(to)
		if up == from || down == to || isDir(up) {
			break
		}
		from, to = up, down
	}
	if from != gone && filepath.Dir(from) != filepath.Dir(to) {
		return gone, live
	}
	return from, to
}

// removeProject settles every session of the group but those replying or
// waiting on the person, and forgets the project.
func (a *App) removeProject() {
	e := &a.editing
	var settle []string
	skipped := 0
	for _, s := range a.list.Sessions {
		if s.Archived || a.groupKeyOf(s.Root) != e.key {
			continue
		}
		if isBusy(a.status(s)) {
			skipped++
			continue
		}
		settle = append(settle, s.ID)
	}
	if e.index >= 0 {
		a.setProjects(slices.Delete(slices.Clone(a.Projects), e.index, e.index+1))
	}
	a.Pins = slices.DeleteFunc(slices.Clone(a.Pins), func(id string) bool {
		return slices.Contains(settle, id)
	})
	e.open = false
	a.settleAll(settle, skipped)
}

// settleAll settles the sessions, then says how many, and how many were
// left as they reply or wait.
func (a *App) settleAll(ids []string, skipped int) {
	message := "Settled " + sessionsCount(len(ids))
	if skipped > 0 {
		message += fmt.Sprintf("; %d still running stay", skipped)
	}
	if slices.Contains(ids, a.selected) {
		a.selected = ""
	}
	a.call(func(ctx context.Context) error {
		var settled []agent.Session
		var failed error
		for _, id := range ids {
			s, err := a.agent.Archive(ctx, id, true)
			if err != nil {
				failed = err
				continue
			}
			settled = append(settled, s)
		}
		a.update(func() {
			for _, s := range settled {
				a.replace(s)
				a.close(s.ID)
			}
			if a.selected == "" {
				a.showFirst()
			}
			a.toast = &toast{message: message}
		})
		return failed
	})
}

// showFirst shows the first session the sidebar lists that is not settled.
func (a *App) showFirst() {
	for _, s := range a.list.Sessions {
		if !s.Archived {
			a.show(s.ID)
			return
		}
	}
}

// setProjects keeps the projects, and groups the sidebar by them.
func (a *App) setProjects(projects []Project) {
	a.Projects = projects
	a.regroup()
	if save := a.SaveProjects; save != nil {
		a.async(func() {
			if err := save(projects); err != nil {
				message := "Could not save the projects: " + err.Error()
				a.update(func() { a.toast = &toast{message: message} })
			}
		})
	}
}

// groupKeyOf is the key of the sidebar group root's sessions are in.
func (a *App) groupKeyOf(root string) string { return groupOf(a.Projects, root).root }

func (a *App) hasSessionsIn(folder string) bool {
	return slices.ContainsFunc(
		a.list.Sessions,
		func(s agent.Session) bool { return s.Root == folder },
	)
}

// projectDialog is Edit project: the name, the source folders, each gone
// one marked, a way to add one, and the removal of the project.
func (a *App) projectDialog(c *ui.Context) {
	e := &a.editing
	if !e.open {
		return
	}
	t := c.Theme()
	p := components.PaletteOf(t)
	ui.Modal(c.Key("edit-project"), &e.open, func() {
		ui.Column(c).Width(460).Gap(16).Children(func() {
			ui.Row(c).AlignItems(ui.Center).Children(func() {
				ui.Text(c, "Edit project").FontSize(components.TextLG(t)).FontWeight(600).Grow(1)
				close := components.ButtonStyle{
					Variant: components.Ghost,
					Size:    components.SizeIconSmall,
					Icon:    icons.X,
				}
				if components.Button(c, "", close).Label("Close").Clicked() {
					e.open = false
				}
			})

			ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
				ui.Icon(c, icons.Folder).FontSize(16).TextColor(p.MutedForeground).Shrink(0)
				if ui.TextInput(c.Key("project-name"), &e.name).
					Placeholder(filepath.Base(e.folders[0])).
					Label("Project name").
					AutoFocus().
					Grow(1).
					Submitted() && e.savable(a) {
					a.saveProject()
				}
			})

			ui.Column(c).Gap(8).Children(func() {
				ui.Text(c, "Source folders").FontWeight(500)
				ui.Column(c).Radius(t.Radius).Border(1, p.Border).Clip().Children(func() {
					for i, folder := range e.folders {
						a.folderRow(c.Key("folder:"+folder), folder, i > 0)
					}
					if a.ChooseFolder != nil {
						add := ui.ButtonBase(c).
							Height(40).
							Padding(0, 12).
							Gap(8).
							AlignItems(ui.Center).
							Justify(ui.Start).
							BorderWidth(1, 0, 0, 0).
							BorderColor(p.Border).
							Label("Add folder")
						if add.Hovered() {
							add.Background(p.Accent.Alpha(0.6))
						}
						add.Children(func() {
							ui.Icon(c, icons.FolderPlus).FontSize(16).TextColor(p.MutedForeground)
							ui.Text(c, "Add folder")
						})
						if add.Clicked() {
							a.addFolder()
						}
					}
				})
			})

			ui.Row(c).Gap(8).AlignItems(ui.Center).Padding(4, 0, 0).Children(func() {
				label := "Remove local project"
				if e.removing {
					label = fmt.Sprintf("Settle %s?", sessionsCount(a.projectSessions(e.key)))
				}
				remove := ui.Button(c, label).
					TextColor(t.Danger).
					Background(t.Danger.Alpha(0.12)).
					Tooltip("Settle the project's sessions and forget the project; no file is touched")
				if remove.Clicked() {
					if e.removing {
						a.removeProject()
					} else {
						e.removing = true
					}
				}
				ui.Box(c).Grow(1)
				if ui.Button(c, "Cancel").Clicked() {
					e.open = false
				}
				if ui.PrimaryButton(c, "Save").Disabled(!e.savable(a)).Clicked() {
					a.saveProject()
				}
			})
		})
	})
}

// folderRow is a source folder of the draft: where it is, marked when gone
// or taken from another project, and a button that takes it out.
func (a *App) folderRow(c *ui.Context, folder string, seam bool) {
	t := c.Theme()
	p := components.PaletteOf(t)
	e := &a.editing
	row := ui.Row(c).Height(40).Padding(0, 6, 0, 12).Gap(8).AlignItems(ui.Center)
	if seam {
		row.BorderWidth(1, 0, 0, 0).BorderColor(p.Border)
	}
	row.Children(func() {
		ui.Icon(c, icons.Folder).FontSize(16).TextColor(p.MutedForeground).Shrink(0)
		ui.Text(c, format.ShortPath(folder)).SingleLine().Shrink(1).Tooltip(folder)
		if live := a.firstPresent(e.folders); live != "" && a.isMissing(folder) {
			ui.Text(c, "sessions go on in "+filepath.Base(live)).
				FontSize(components.TextXS(t)).
				TextColor(p.MutedForeground).
				SingleLine().
				Shrink(1000).
				Tooltip("On saving, its sessions go on in " + live + ", their history kept")
		}
		if from, ok := e.moves[folder]; ok {
			ui.Text(c, "moves from "+from).
				FontSize(components.TextXS(t)).
				TextColor(p.MutedForeground).
				SingleLine().
				Shrink(1000)
		}
		ui.Box(c).Grow(1)
		if a.isMissing(folder) {
			components.Tag(c, "Missing", p.Destructive).
				Tooltip("Not there any more: moved, renamed or deleted")
		}
		drop := components.Button(c, "", components.ButtonStyle{
			Variant:  components.Ghost,
			Size:     components.SizeIconSmall,
			Icon:     icons.X,
			Disabled: len(e.folders) <= 1,
		}).
			Label("Remove " + filepath.Base(folder)).
			Tooltip("Take the folder out of the project")
		if drop.Clicked() {
			a.dropFolder(folder)
		}
	})
}

// projectSessions is how many sessions not settled the group holds.
func (a *App) projectSessions(key string) int {
	n := 0
	for _, s := range a.list.Sessions {
		if !s.Archived && a.groupKeyOf(s.Root) == key {
			n++
		}
	}
	return n
}

func sessionsCount(n int) string {
	if n == 1 {
		return "1 session"
	}
	return fmt.Sprintf("%d sessions", n)
}
