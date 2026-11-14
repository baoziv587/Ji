package app

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/egoist/mygo/plugins/terminal"
	"github.com/egoist/mygo/ui"
)

// repository makes a git repository with a commit of two files, then
// changes one, deletes the other and adds a third that git does not know.
func repository(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	run := func(args ...string) {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(),
			"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t",
			"GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	write := func(name, text string) {
		path := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(text), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	run("init", "-q")
	write("src/app.go", "package app\n\nfunc a() {}\n")
	write("old.txt", "gone\n")
	run("add", ".")
	run("commit", "-q", "-m", "first")
	write("src/app.go", "package app\n\nfunc a() { b() }\n")
	if err := os.Remove(filepath.Join(dir, "old.txt")); err != nil {
		t.Fatal(err)
	}
	write("notes.md", "# notes\nmore\n")
	return dir
}

func TestReadChangesListsWhatChangedSinceTheCommit(t *testing.T) {
	files, err := readChanges(repository(t))
	if err != nil {
		t.Fatal(err)
	}
	got := map[string][2]int{}
	for _, f := range files {
		got[f.name] = [2]int{f.added, f.deleted}
	}
	want := map[string][2]int{"src/app.go": {1, 1}, "old.txt": {0, 1}, "notes.md": {2, 0}}
	if len(got) != len(want) {
		t.Fatalf("changes %v", got)
	}
	for name, n := range want {
		if got[name] != n {
			t.Errorf("%s: +%d −%d, want +%d −%d", name, got[name][0], got[name][1], n[0], n[1])
		}
	}

	if _, err := readChanges(t.TempDir()); err != errNotRepository {
		t.Errorf("a folder outside git: %v", err)
	}
}

func TestThePanelShowsTheDiffOfTheSessionsFolder(t *testing.T) {
	a, _ := testApp()
	a.list.Sessions[0].Root = repository(t)
	tt := ui.NewTester(a.View, 1300, 800)

	if err := tt.Click("Show Panel"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if !tt.HasText("Open a surface") || !tt.HasText("Terminal") {
		t.Fatalf("the panel does not offer what it opens: %q", tt.Texts())
	}
	tt.Key(0, ui.KeyD)
	tt.Frame()
	if !tt.HasText("3 files changed") || !tt.HasText("notes.md") || !tt.HasText("+3") {
		t.Fatalf("the diff does not list the changes: %q", tt.Texts())
	}
	if err := tt.Click("notes.md"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if d := a.views["a"].panel.tabs[0].diff; d.files[d.chosen].name != "notes.md" {
		t.Errorf("chose %q", d.files[d.chosen].name)
	}

	if err := tt.Click("Close Diff"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if !tt.HasText("Open a surface") {
		t.Errorf("the last tab closed leaves no picker: %q", tt.Texts())
	}
	if err := tt.Click("Hide Panel"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if tt.HasText("Open a surface") || a.views["a"].panel.open {
		t.Error("the panel stays")
	}
}

func TestADiffOutsideGitSaysSo(t *testing.T) {
	a, _ := testApp()
	a.list.Sessions[0].Root = t.TempDir()
	tt := ui.NewTester(a.View, 1300, 800)

	tt.Key(ui.Cmd, ui.KeyJ)
	tt.Frame()
	if err := tt.Click("Diff"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if !tt.HasText("Not a Git repository") {
		t.Errorf("texts %q", tt.Texts())
	}
}

func TestATerminalRunsInTheSessionsFolderAndClosesWithItsShell(t *testing.T) {
	if testing.Short() {
		t.Skip("starts a shell, with Ghostty's library")
	}
	a, _ := testApp()
	dir := t.TempDir()
	a.list.Sessions[0].Root = dir
	a.NewTerminal = func(o terminal.Options) (*terminal.Terminal, error) {
		o.Command = []string{"/bin/sh"}
		return terminal.New(o)
	}
	// The shell's title and exit come from the terminal's goroutines
	updates := make(chan func(), 64)
	a.update = func(fn func()) { updates <- fn }
	tt := ui.NewTester(a.View, 1300, 800)
	frame := func() {
		time.Sleep(20 * time.Millisecond)
		for len(updates) > 0 {
			(<-updates)()
		}
		tt.Frame()
	}

	tt.Key(ui.Cmd, ui.KeyJ)
	tt.Frame()
	tt.Key(0, ui.KeyT)
	tt.Frame()
	pn := &a.views["a"].panel
	if len(pn.tabs) != 1 || pn.tabs[0].term == nil {
		t.Fatalf("tabs %+v", pn.tabs)
	}
	term := pn.tabs[0].term.term
	tt.Type("pwd")
	tt.Key(0, ui.KeyEnter)
	real, _ := filepath.EvalSymlinks(dir)
	for deadline := time.Now().Add(10 * time.Second); !strings.Contains(term.Text(), real); {
		if time.Now().After(deadline) {
			t.Fatalf("the shell is not in the session's folder: %q", term.Text())
		}
		frame()
	}

	tt.Type("exit")
	tt.Key(0, ui.KeyEnter)
	for deadline := time.Now().Add(10 * time.Second); len(pn.tabs) > 0; {
		if time.Now().After(deadline) {
			t.Fatal("the tab stays after its shell exits")
		}
		frame()
	}
}
