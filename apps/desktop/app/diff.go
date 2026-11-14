package app

// The diff of the panel: what changed in the session's folder since its
// last commit, as git diff tells it, files not yet added to git with it;
// a file at a time, chosen from the list over it. It is read again as it
// opens and as each reply ends.

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/editor"

	"desktop/agent"
	"desktop/ui/components"
	"desktop/ui/fileicons"
	"desktop/ui/icons"
)

// emptyTree is git's tree with nothing in it, which a repository without
// a commit yet is compared with.
const emptyTree = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

// maxUntracked is how many files not yet added to git the diff shows, and
// maxUntrackedSize how big one is at most: those of a build or a download
// left out of .gitignore would else take the panel.
const (
	maxUntracked     = 200
	maxUntrackedSize = 1 << 20
)

var errNotRepository = errors.New("not a Git repository")

type changedFile struct {
	patch          editor.FilePatch
	name           string
	added, deleted int
}

type diffSurface struct {
	root    string
	loading bool
	loaded  bool
	err     error
	files   []changedFile
	chosen  int
	state   *editor.DiffState
	list    ui.ListState
	// Whether the session was replying as the diff last showed: the end of
	// a reply reads the changes again.
	replying bool
}

// loadDiff reads the changes again, keeping the file chosen.
func (a *App) loadDiff(d *diffSurface) {
	if d.loading {
		return
	}
	d.loading = true
	root := d.root
	a.async(func() {
		files, err := readChanges(root)
		a.update(func() {
			d.loading, d.loaded, d.err = false, true, err
			chosen := ""
			if d.chosen < len(d.files) {
				chosen = d.files[d.chosen].name
			}
			d.files = files
			same := func(f changedFile) bool { return f.name == chosen }
			d.chosen = max(slices.IndexFunc(files, same), 0)
			d.show(chosen)
		})
	})
}

// show builds the diff of the file chosen, where the last one of the same
// file was scrolled to.
func (d *diffSurface) show(was string) {
	if d.chosen >= len(d.files) {
		d.state = nil
		return
	}
	f := d.files[d.chosen]
	state := &editor.DiffState{Layout: editor.DiffUnified, Indicators: editor.DiffClassic}
	state.SetPatch(f.patch)
	if d.state != nil && was == f.name {
		state.SetScrollY(d.state.ScrollY())
	}
	d.state = state
}

// readChanges is what changed in the repository holding root since its
// last commit, the files not yet added to git after those it knows.
func readChanges(root string) ([]changedFile, error) {
	git := func(args ...string) ([]byte, error) {
		cmd := exec.Command("git", args...)
		cmd.Dir = root
		return cmd.Output()
	}
	if _, err := git("rev-parse", "--git-dir"); err != nil {
		return nil, errNotRepository
	}
	base := "HEAD"
	if _, err := git("rev-parse", "--verify", "--quiet", "HEAD"); err != nil {
		base = emptyTree
	}
	patch, err := git("diff", "--no-color", "--no-ext-diff", "--find-renames", base, "--")
	if err != nil {
		return nil, gitError(err)
	}
	others, err := git("ls-files", "--others", "--exclude-standard", "-z")
	if err != nil {
		return nil, gitError(err)
	}
	var all bytes.Buffer
	all.Write(patch)
	for i, name := range strings.Split(strings.TrimRight(string(others), "\x00"), "\x00") {
		if name == "" || i >= maxUntracked {
			break
		}
		info, err := os.Stat(filepath.Join(root, name))
		if err != nil || info.Size() > maxUntrackedSize {
			continue
		}
		// --no-index exits with 1 when the files differ, as they do
		added, _ := git("diff", "--no-color", "--no-ext-diff", "--no-index", "--", os.DevNull, name)
		all.Write(added)
	}

	patches, err := editor.ParsePatch(all.String())
	if err != nil {
		return nil, err
	}
	files := make([]changedFile, 0, len(patches))
	for _, p := range patches {
		files = append(files, changedFileOf(p))
	}
	return files, nil
}

// changedFileOf is a file's patch, named as it is now (as it was, deleted),
// with the lines it adds and deletes counted.
func changedFileOf(p editor.FilePatch) changedFile {
	f := changedFile{patch: p, name: p.NewName}
	if f.name == "" {
		f.name = p.OldName
	}
	for _, h := range p.Hunks {
		for _, line := range h.Lines {
			switch {
			case strings.HasPrefix(line, "+"):
				f.added++
			case strings.HasPrefix(line, "-"):
				f.deleted++
			}
		}
	}
	return f
}

// gitError is what git said went wrong, rather than its exit status.
func gitError(err error) error {
	var exit *exec.ExitError
	if errors.As(err, &exit) && len(exit.Stderr) > 0 {
		return errors.New(strings.TrimSpace(string(exit.Stderr)))
	}
	return err
}

// diffView shows the changes: how many, the files, then the chosen one's.
func (a *App) diffView(c *ui.Context, s agent.Session, view *sessionView, d *diffSurface) {
	p := components.PaletteOf(c.Theme())
	if replying := view.t.State.Replying; replying != d.replying {
		if d.replying {
			a.loadDiff(d)
		}
		d.replying = replying
	}

	added, deleted := 0, 0
	for _, f := range d.files {
		added += f.added
		deleted += f.deleted
	}
	ui.Row(c).
		Height(36).
		Padding(0, 8, 0, 16).
		Gap(8).
		AlignItems(ui.Center).
		Shrink(0).
		Children(func() {
			summary := "Changes"
			if d.loaded && d.err == nil {
				n := len(d.files)
				summary = fmt.Sprintf("%d %s changed", n, plural(n, "file", "files"))
			}
			ui.Text(c, summary).FontWeight(500).SingleLine().Shrink(1)
			lineCounts(c, p, added, deleted)
			ui.Box(c).Grow(1)
			refresh := components.ButtonStyle{
				Variant:  components.Ghost,
				Size:     components.SizeIconSmall,
				Icon:     icons.RefreshCw,
				Disabled: d.loading,
			}
			if components.Button(c, "", refresh).
				Label("Refresh").
				Tooltip("Read the changes again").
				Clicked() {
				a.loadDiff(d)
			}
		})
	ui.Box(c).Height(1).Background(p.Border).Shrink(0)

	switch {
	case !d.loaded:
		ui.Column(c).Fill().Center().Children(func() {
			components.Spinner(c, "Reading the changes", 16, ui.Color{})
		})
		return
	case errors.Is(d.err, errNotRepository):
		diffEmpty(c, icons.GitBranch, "Not a Git repository",
			"The diff shows what changed since the last commit, in a folder that git tracks.")
		return
	case d.err != nil:
		diffEmpty(c, icons.TriangleAlert, "Could not read the changes", d.err.Error())
		return
	case len(d.files) == 0:
		diffEmpty(
			c,
			icons.Check,
			"No changes",
			"Nothing changed in "+filepath.Base(s.Root)+" since the last commit.",
		)
		return
	}

	rows := min(len(d.files), 6)
	ui.List(c.Key("files"), &d.list, len(d.files), func(i int) {
		a.changedFileRow(c, d, i)
	}).Height(float32(rows)*28+8).Padding(4, 8).Shrink(0)
	ui.Box(c).Height(1).Background(p.Border).Shrink(0)

	f := d.files[d.chosen]
	if f.patch.Binary || d.state == nil {
		diffEmpty(c, icons.File, "Binary file", f.name+" changed; its contents are not text.")
		return
	}
	editor.DiffView(c.Key("diff:"+f.name), d.state).Grow(1).MinHeight(0).FillWidth()
}

// changedFileRow is a file of the list: its icon, name and folder,
// and the lines it added and deleted; the one chosen is shown below.
func (a *App) changedFileRow(c *ui.Context, d *diffSurface, i int) {
	t := c.Theme()
	p := components.PaletteOf(t)
	f := d.files[i]
	row := ui.ButtonBase(c).
		Height(28).
		Padding(0, 8).
		Gap(8).
		Radius(6).
		AlignItems(ui.Center).
		FocusRing(false).
		Label(f.name).
		Tooltip(f.name)
	components.FocusRing(row, p, 0)
	switch {
	case i == d.chosen:
		row.Background(p.Accent)
	case row.Hovered():
		row.Background(p.Accent.Alpha(0.5))
	}
	row.Children(func() {
		ui.Image(c, fileicons.For(f.name)).Size(16, 16).Shrink(0)
		dir, base := filepath.Split(f.name)
		ui.Row(c).Gap(6).AlignItems(ui.Center).Grow(1).Shrink(1).MinWidth(0).Children(func() {
			ui.Text(c, base).SingleLine().Shrink(0).MaxWidth(240)
			if dir != "" {
				ui.Text(c, strings.TrimSuffix(dir, "/")).
					FontSize(components.TextXS(t)).
					TextColor(p.MutedForeground).
					SingleLine().
					Shrink(1)
			}
		})
		lineCounts(c, p, f.added, f.deleted)
	})
	if row.Clicked() && i != d.chosen {
		was := d.files[d.chosen].name
		d.chosen = i
		d.show(was)
	}
}

// lineCounts is how many lines were added and deleted, each left out at 0.
func lineCounts(c *ui.Context, p *components.Palette, added, deleted int) {
	if added > 0 {
		figures(c, fmt.Sprintf("+%d", added), p.Success)
	}
	if deleted > 0 {
		figures(c, fmt.Sprintf("−%d", deleted), p.Destructive)
	}
}

func diffEmpty(c *ui.Context, icon *ui.SVG, title, text string) {
	ui.Column(c).Fill().Center().Padding(32).Children(func() {
		components.EmptyHeader(c, icon, title, text)
	})
}

func plural(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}
