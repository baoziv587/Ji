package app

import (
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/egoist/mygo/ui"
)

func TestOnlyPinnedSessionsShowOverTheFolders(t *testing.T) {
	a, _ := testApp()
	var saved []string
	a.SavePins = func(pins []string) { saved = pins }
	tt := ui.NewTester(a.View, 1100, 700)

	if n := len(a.groups().pinned); n != 0 {
		t.Errorf("%d sessions over the folders before any is pinned", n)
	}
	if !*a.opened["/code/web"] || !tt.HasText("Upgrade React") {
		t.Error("a folder's sessions do not show under it")
	}

	a.pin("c", true)
	tt.Frame()
	g := a.groups()
	if len(g.pinned) != 1 || a.list.Sessions[g.pinned[0]].ID != "c" ||
		!slices.Equal(saved, []string{"c"}) {
		t.Errorf("pinned %v, saved %v", g.pinned, saved)
	}
	for _, f := range g.folders {
		if f.root == "/code/web" && len(f.sessions) != 1 {
			t.Errorf("a pinned session shows under its folder too: %v", f.sessions)
		}
	}
	if !tt.HasText("web (1)") {
		t.Errorf("the folder does not count what is left in it: %q", tt.Texts())
	}

	a.pin("c", false)
	tt.Frame()
	if len(a.groups().pinned) != 0 || len(saved) != 0 {
		t.Errorf("unpinned, %v still pinned", saved)
	}
}

func TestFoldedFolderSaysWhenItsSessionWaits(t *testing.T) {
	a, _ := testApp()
	tt := ui.NewTester(a.View, 1100, 700)

	if err := tt.Click("api (1)"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if *a.opened["/code/api"] || tt.HasText("Add rate limits") {
		t.Fatal("the folder does not fold")
	}
	if !tt.HasText("Approval") {
		t.Errorf("a folded folder hides that its session waits: %q", tt.Texts())
	}
}

func TestSearchFindsSessionsByTitleAndFolder(t *testing.T) {
	a, _ := testApp()
	tt := ui.NewTester(a.View, 1100, 700)

	a.search = "react"
	tt.Frame()
	if !tt.HasText("Upgrade React") || tt.HasText("Add rate limits") {
		t.Errorf("searching react shows %q", tt.Texts())
	}

	a.search = "old"
	tt.Frame()
	if !tt.HasText("Old spike") {
		t.Errorf("an archived session is not found by its folder: %q", tt.Texts())
	}

	a.search = "nothing like it"
	tt.Frame()
	if !tt.HasText("No sessions match") {
		t.Errorf("no word that nothing matches: %q", tt.Texts())
	}
}

func TestSidebarHides(t *testing.T) {
	a, _ := testApp()
	tt := ui.NewTester(a.View, 1100, 700)

	if err := tt.Click("Hide Sidebar"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if tt.HasText("Search sessions") || !a.Layout.SidebarHidden {
		t.Fatal("the sidebar shows once hidden")
	}
	if err := tt.Click("Show Sidebar"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if !tt.HasText("Search sessions") {
		t.Error("the sidebar does not show again")
	}
}

func TestBranchOf(t *testing.T) {
	repo := t.TempDir()
	write := func(path, text string) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write(filepath.Join(repo, ".git", "HEAD"), "ref: refs/heads/feature/login\n")
	inside := filepath.Join(repo, "src", "app")
	if err := os.MkdirAll(inside, 0o755); err != nil {
		t.Fatal(err)
	}

	worktree := t.TempDir()
	write(filepath.Join(repo, ".git", "worktrees", "w", "HEAD"), "0123456789abcdef\n")
	gitDir := filepath.Join(repo, ".git", "worktrees", "w")
	write(filepath.Join(worktree, ".git"), "gitdir: "+gitDir+"\n")

	for dir, want := range map[string]string{
		repo:        "feature/login",
		inside:      "feature/login",
		worktree:    "0123456",
		t.TempDir(): "",
		"relative":  "",
	} {
		if got := branchOf(dir); got != want {
			t.Errorf("branchOf(%q) = %q, want %q", dir, got, want)
		}
	}
}
