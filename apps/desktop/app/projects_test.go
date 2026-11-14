package app

import (
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/egoist/mygo/ui"

	"desktop/agent"
)

// renamed is the test app with /code/web moved to /code/site.
func renamed(t *testing.T) (*App, *fakeAgent, *ui.Tester, *[][]Project) {
	t.Helper()
	a, f := testApp()
	var saved [][]Project
	a.SaveProjects = func(p []Project) error {
		saved = append(saved, p)
		return nil
	}
	a.OpenInEditor = func(string) error { return nil }
	a.ChooseFolder = func() (string, error) { return "/code/site", nil }
	a.isDir = func(path string) bool { return path != "/code/web" }
	a.readFolders(a.roots()...)
	f.sessions = a.list.Sessions
	return a, f, ui.NewTester(a.View, 1100, 700), &saved
}

func TestAddingWhereAGoneFolderWentMovesItsSessions(t *testing.T) {
	a, f, tt, saved := renamed(t)

	if !tt.HasText("/code/web no longer exists.") {
		t.Fatalf("no word that the folder is gone: %q", tt.Texts())
	}
	if tt.HasText("Message") || tt.HasText("Open in VS Code") {
		t.Error("a session whose folder is gone still takes messages or opens in the editor")
	}
	if !tt.HasText("Missing") {
		t.Error("the project's head does not say its folder is gone")
	}

	if err := tt.Click("Edit Project…"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if !tt.HasText("Edit project") || !tt.HasText("Source folders") {
		t.Fatalf("no dialog: %q", tt.Texts())
	}
	if err := tt.Click("Add folder"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if !tt.HasText("/code/site") || !tt.HasText("sessions go on in site") {
		t.Fatalf("the folder added does not show: %q", tt.Texts())
	}
	if err := tt.Click("Save"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()

	if !slices.Equal(f.roots, []string{"a > /code/site", "c > /code/site"}) {
		t.Fatalf("moved %v", f.roots)
	}
	want := []Project{{Name: "web", Folders: []string{"/code/site"}}}
	if !reflect.DeepEqual(a.Projects, want) || len(*saved) != 2 ||
		!reflect.DeepEqual((*saved)[1], want) {
		t.Fatalf("projects %+v, saved %+v", a.Projects, *saved)
	}
	if s, _ := a.session("a"); s.Root != "/code/site" {
		t.Errorf("the session works in %q", s.Root)
	}
	if tt.HasText("Edit project") || tt.HasText("/code/web no longer exists.") ||
		tt.HasText("Missing") {
		t.Errorf("the folder still shows as gone: %q", tt.Texts())
	}
	if !tt.HasText("web (2)") || !tt.HasText("Message") {
		t.Errorf("the session does not go on under its project: %q", tt.Texts())
	}
}

func TestContinueMovesTheSessionsToTheProjectsFolder(t *testing.T) {
	a, f, tt, _ := renamed(t)
	a.Projects = []Project{{Folders: []string{"/code/web", "/code/site"}}}
	a.regroup()
	tt.Frame()

	if err := tt.Click("Continue in site"); err != nil {
		t.Fatalf("%v: %q", err, tt.Texts())
	}
	tt.Frame()
	if !slices.Equal(f.roots, []string{"a > /code/site", "c > /code/site"}) {
		t.Errorf("moved %v", f.roots)
	}
	if tt.HasText("/code/web no longer exists.") {
		t.Error("the notice stays once the sessions moved")
	}
}

func TestSavingAgainMovesWhatAnEarlierSaveLeft(t *testing.T) {
	a, f, tt, _ := renamed(t)
	a.Projects = []Project{{Folders: []string{"/code/web", "/code/site"}}}
	a.regroup()
	a.EditProject("/code/web")
	tt.Frame()

	if err := tt.Click("Save"); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(f.roots, []string{"a > /code/site", "c > /code/site"}) {
		t.Errorf("moved %v", f.roots)
	}
}

func TestMoveOfFindsTheFolderRenamedAboveBoth(t *testing.T) {
	isDir := func(path string) bool {
		return path == "/u/projects" || path == "/u" || path == "/" || path == "/code"
	}
	for _, c := range []struct{ gone, live, from, to string }{
		{
			"/u/projects/pi-rsi/apps/agent", "/u/projects/ji/apps/agent",
			"/u/projects/pi-rsi", "/u/projects/ji",
		},
		{"/code/web", "/code/site", "/code/web", "/code/site"},
		{"/old/a/web", "/code/web", "/old/a/web", "/code/web"},
	} {
		if from, to := moveOf(c.gone, c.live, isDir); from != c.from || to != c.to {
			t.Errorf("moveOf(%q, %q) = %q, %q", c.gone, c.live, from, to)
		}
	}
}

func TestProjectGroupsItsFoldersSessions(t *testing.T) {
	a, _, tt, _ := renamed(t)
	a.Projects = []Project{{Name: "Site", Folders: []string{"/code/web", "/code/api"}}}
	a.regroup()
	tt.Frame()

	if !tt.HasText("Site (3)") || tt.HasText("api (1)") {
		t.Errorf("one project shows as %q", tt.Texts())
	}
	if tt.HasText("Missing") {
		t.Error("a project with a folder still there is called missing")
	}
	if got := a.liveFolder("/code/web"); got != "/code/api" {
		t.Errorf("new sessions start in %q", got)
	}
}

func TestDialogEditsTheDraftOnly(t *testing.T) {
	a, _, tt, saved := renamed(t)
	a.Projects = []Project{{Folders: []string{"/code/api"}}}
	a.EditProject("/code/web")
	tt.Frame()

	if !a.editing.open || a.editing.edited() {
		t.Fatal("the draft starts edited")
	}
	a.draftFolder("/code/api")
	a.draftFolder("/code/api")
	tt.Frame()
	if len(a.editing.folders) != 2 || !tt.HasText("moves from api") {
		t.Errorf("folders %v: %q", a.editing.folders, tt.Texts())
	}
	a.dropFolder("/code/web")
	a.dropFolder("/code/api")
	if !slices.Equal(a.editing.folders, []string{"/code/api"}) {
		t.Errorf("the last folder can be dropped: %v", a.editing.folders)
	}
	tt.Frame()

	if err := tt.Click("Cancel"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if a.editing.open || len(*saved) != 0 {
		t.Error("cancelling keeps something")
	}

	a.EditProject("/code/web")
	a.editing.name = "Website"
	a.saveProject()
	want := []Project{
		{Folders: []string{"/code/api"}},
		{Name: "Website", Folders: []string{"/code/web"}},
	}
	if !reflect.DeepEqual(a.Projects, want) {
		t.Errorf("projects %+v", a.Projects)
	}
}

func TestRemovingAProjectSettlesWhatIsNotRunning(t *testing.T) {
	a, f, tt, saved := renamed(t)
	a.Projects = []Project{{Folders: []string{"/code/web", "/code/site"}}}
	a.Pins = []string{"a"}
	a.list.Sessions[2].Status = "running"
	a.regroup()
	a.EditProject("/code/web")
	tt.Frame()

	if err := tt.Click("Remove local project"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if len(f.archived) != 0 || !tt.HasText("Settle 2 sessions?") {
		t.Fatalf("the first click settles, or does not ask: %q", tt.Texts())
	}
	if err := tt.Click("Settle 2 sessions?"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()

	if !slices.Equal(f.archived, []string{"a:on"}) {
		t.Errorf("settled %v", f.archived)
	}
	if len(a.Projects) != 0 || len(*saved) != 1 || len(a.Pins) != 0 {
		t.Errorf("projects %+v, pins %v", a.Projects, a.Pins)
	}
	if !slices.ContainsFunc(
		tt.Texts(),
		func(s string) bool { return strings.Contains(s, "1 still running") },
	) {
		t.Errorf("no word of the session left running: %q", tt.Texts())
	}
}

func TestARenamedRepositoryTakesItsOtherFoldersSessionsAlong(t *testing.T) {
	a, f := testApp()
	a.isDir = func(path string) bool { return !strings.HasPrefix(path, "/p/pi-rsi") }
	a.setList(agent.Sessions{Sessions: []agent.Session{
		{ID: "x", Root: "/p/pi-rsi/apps/agent", Title: "Agent"},
		{ID: "y", Root: "/p/pi-rsi/apps/desktop", Title: "Desktop"},
		{ID: "z", Root: "/code/web", Title: "Elsewhere"},
	}})
	f.sessions = a.list.Sessions
	a.Projects = []Project{{Folders: []string{"/p/pi-rsi/apps/agent", "/p/ji/apps/agent"}}}

	a.moveFolders([]string{"/p/pi-rsi/apps/agent"}, "/p/ji/apps/agent")

	if !slices.Equal(f.roots, []string{"x > /p/ji/apps/agent", "y > /p/ji/apps/desktop"}) {
		t.Errorf("moved %v", f.roots)
	}
	want := []Project{{Name: "agent", Folders: []string{"/p/ji/apps/agent"}}}
	if !reflect.DeepEqual(a.Projects, want) {
		t.Errorf("projects %+v", a.Projects)
	}
}
