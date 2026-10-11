package app

import (
	"context"
	"fmt"
	"image/png"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/egoist/mygo/ui"

	"desktop/agent"
)

// fakeAgent records what the window asked of the service, and plays back
// the events each session has.
type fakeAgent struct {
	events   map[string][]agent.Event
	followed []string
	created  []string
	sent     map[string][]string
	commands map[string][]string
	answers  map[string][][]string
	archived []string
	stopped  []string
	modes    int
}

func (f *fakeAgent) FollowSessions(context.Context, func(agent.Sessions), func(error)) {}
func (f *fakeAgent) CreateSession(_ context.Context, root string) (agent.Session, error) {
	f.created = append(f.created, root)
	return agent.Session{ID: "new", Root: root, Updated: time.Now().UnixMilli()}, nil
}
func (f *fakeAgent) Archive(_ context.Context, id string, archived bool) (agent.Session, error) {
	f.archived = append(f.archived, id+map[bool]string{true: ":on", false: ":off"}[archived])
	return agent.Session{ID: id, Root: "/code/" + id, Title: "Title " + id, Archived: archived}, nil
}
func (f *fakeAgent) State(context.Context, string) (agent.State, error) { return agent.State{}, nil }
func (f *fakeAgent) Send(_ context.Context, id, text string) (string, error) {
	f.sent[id] = append(f.sent[id], text)
	return "started", nil
}
func (f *fakeAgent) Command(_ context.Context, id, line string) (string, error) {
	f.commands[id] = append(f.commands[id], line)
	return "ran", nil
}
func (f *fakeAgent) Answer(_ context.Context, id, question string, answers [][]string) error {
	f.answers[id+"/"+question] = answers
	return nil
}
func (f *fakeAgent) Stop(_ context.Context, id string) error {
	f.stopped = append(f.stopped, id)
	return nil
}
func (f *fakeAgent) SwitchMode(_ context.Context, id string) (agent.State, error) {
	f.modes++
	return agent.State{ID: id, Mode: "auto"}, nil
}
func (f *fakeAgent) Think(_ context.Context, id, _ string) (agent.State, error) {
	return agent.State{ID: id}, nil
}
func (f *fakeAgent) Follow(_ context.Context, id string, _ int, fn func(agent.Event)) {
	f.followed = append(f.followed, id)
	for _, e := range f.events[id] {
		fn(e)
	}
}

// testCommands are the service's commands, as a session lists them.
var testCommands = []agent.Command{
	{Name: "/think", Arg: "<off|high>", Hint: "sets thinking", Choices: []string{"off", "high"}},
	{Name: "/fast", Arg: "[on|off]", Hint: "answers faster, for more usage", Choices: []string{"on", "off"}},
	{Name: "/compact", Hint: "summarizes the conversation so far"},
	{Name: "/help", Hint: "lists keys, commands and tools"},
	{Name: "/exit", Hint: "quits"},
	{Name: "/login", Arg: "<provider>", Hint: "signs in: in the browser, or with a key typed in", Choices: []string{"deepseek", "openai", "openai-codex"}},
	{Name: "/impeccable", Arg: "[command]", Hint: "designs and polishes interfaces", Group: "Skills"},
}

// testApp runs every action at once, on the test's goroutine, with three
// sessions in two folders and one archived.
func testApp() (*App, *fakeAgent) {
	now := time.Now().UnixMilli()
	f := &fakeAgent{events: map[string][]agent.Event{}, sent: map[string][]string{}, commands: map[string][]string{}, answers: map[string][][]string{}}
	for _, id := range []string{"a", "b", "c", "d"} {
		f.events[id] = []agent.Event{{Type: "state", State: &agent.State{ID: id, Root: "/code/" + id, Model: "deepseek/deepseek-flash", Mode: "ask", Thinking: "high", ThinkingLevels: []string{"off", "high"}, Commands: testCommands}}}
	}
	a := New(f, func(fn func()) { fn() })
	a.async = func(fn func()) { fn() }
	a.connected = true
	a.setList(agent.Sessions{DefaultRoot: "/code/web", Sessions: []agent.Session{
		{ID: "a", Root: "/code/web", Title: "Fix the login form", Updated: now},
		{ID: "b", Root: "/code/api", Title: "Add rate limits", Updated: now - 3_600_000, Status: "asking"},
		{ID: "c", Root: "/code/web", Title: "Upgrade React", Updated: now - 7_200_000},
		{ID: "d", Root: "/code/old", Title: "Old spike", Updated: now - 86_400_000, Archived: true},
	}})
	return a, f
}

func TestSidebarGroupsSessionsByFolder(t *testing.T) {
	a, f := testApp()
	tt := ui.NewTester(a.View, 1100, 700)

	for _, text := range []string{"web", "api", "Fix the login form", "Add rate limits", "Upgrade React", "Approval", "Archived (1)"} {
		if !tt.HasText(text) {
			t.Errorf("no %q in %q", text, tt.Texts())
		}
	}
	if tt.HasText("Old spike") {
		t.Error("an archived session shows while its section is closed")
	}
	if a.selected != "a" || !reflect.DeepEqual(f.followed, []string{"a"}) {
		t.Errorf("selected %q, followed %v: the most recent session opens first", a.selected, f.followed)
	}
}

// A long conversation builds only what is in view, and shows its end as it
// streams on.
func TestLongConversationFollowsItsEnd(t *testing.T) {
	a, _ := testApp()
	view := a.views["a"]
	for i := range 300 {
		a.apply(view, agent.Event{Type: "user", Text: fmt.Sprintf("Question %d", i)})
	}
	a.apply(view, agent.Event{Type: "text", Delta: "The newest reply"})
	tt := ui.NewTester(a.View, 1180, 780)
	if tt.HasText("Question 0") || !tt.HasText("Question 299") || !tt.HasText("The newest reply") {
		t.Fatal("the end of the conversation is not in view, or all of it is built")
	}
	a.apply(view, agent.Event{Type: "text", Delta: " goes on"})
	tt.Frame()
	if !tt.HasText("The newest reply goes on") {
		t.Fatal("the reply as it streams is not in view")
	}
}

func TestChoosingASessionShowsIt(t *testing.T) {
	a, f := testApp()
	f.events["c"] = append(f.events["c"], agent.Event{Type: "user", Text: "bump react to 19"}, agent.Event{Type: "text", Delta: "Bumped."})
	tt := ui.NewTester(a.View, 1100, 700)

	if err := tt.Click("Upgrade React"); err != nil {
		t.Fatal(err)
	}

	if a.selected != "c" || !tt.HasText("bump react to 19") || !tt.HasText("Bumped.") {
		t.Errorf("selected %q, texts %q", a.selected, tt.Texts())
	}
}

func TestEnterSendsToTheChosenSession(t *testing.T) {
	a, f := testApp()
	tt := ui.NewTester(a.View, 1100, 700)

	if err := tt.Click("Message"); err != nil {
		t.Fatal(err)
	}
	tt.Type("explain")
	tt.Key(ui.Shift, ui.KeyEnter)
	tt.Type("main.go")
	tt.Key(0, ui.KeyEnter)

	if got := f.sent["a"]; !reflect.DeepEqual(got, []string{"explain\nmain.go"}) {
		t.Errorf("sent %q", got)
	}
}

func TestDraftsStayWithTheirSessions(t *testing.T) {
	a, _ := testApp()
	tt := ui.NewTester(a.View, 1100, 700)
	if err := tt.Click("Message"); err != nil {
		t.Fatal(err)
	}
	tt.Type("half a thought")

	if err := tt.Click("Upgrade React"); err != nil {
		t.Fatal(err)
	}
	if err := tt.Click("Fix the login form"); err != nil {
		t.Fatal(err)
	}

	if a.views["a"].draft != "half a thought" || a.views["c"].draft != "" {
		t.Errorf("drafts %q and %q", a.views["a"].draft, a.views["c"].draft)
	}
}

func TestApprovalAnswersWithAClick(t *testing.T) {
	a, f := testApp()
	f.events["a"] = append(f.events["a"], agent.Event{Type: "ask", ID: "7", Tool: "bash", Questions: []agent.Question{{
		Title:   "Run bash",
		Detail:  "pnpm test",
		Options: []agent.Option{{Value: "yes", Label: "Yes"}, {Value: "commands", Label: "Yes, and allow every command from now on"}, {Value: "no", Label: "No"}},
	}}})
	a.views = map[string]*sessionView{}
	f.followed = nil
	a.Select("a")
	tt := ui.NewTester(a.View, 1100, 700)

	if !tt.HasText("Run bash") || !tt.HasText("pnpm test") {
		t.Fatalf("texts %q", tt.Texts())
	}
	if err := tt.Click("No"); err != nil {
		t.Fatal(err)
	}

	if got := f.answers["a/7"]; !reflect.DeepEqual(got, [][]string{{"no"}}) {
		t.Errorf("answered %v", got)
	}
}

// A write's approval shows the whole file, and builds only the lines in
// view.
func TestLongApprovalBuildsWhatIsInView(t *testing.T) {
	a, _ := testApp()
	view := a.views["a"]
	lines := make([]string, 2000)
	for i := range lines {
		lines[i] = fmt.Sprintf("+line %d", i)
	}
	a.apply(view, agent.Event{Type: "ask", ID: "9", Tool: "write", Questions: []agent.Question{{
		Title:   "Write index.html",
		Detail:  strings.Join(lines, "\n"),
		Options: []agent.Option{{Value: "yes", Label: "Yes"}, {Value: "no", Label: "No"}},
	}}})
	tt := ui.NewTester(a.View, 1180, 780)

	if !tt.HasText("+line 0") || tt.HasText("+line 1999") || !tt.HasText("Yes") {
		t.Fatalf("the start of the file is not in view, or all of it is built")
	}
}

func TestModelQuestionTakesPicksAndTypedAnswers(t *testing.T) {
	a, f := testApp()
	view := a.views["a"]
	a.apply(view, agent.Event{Type: "ask", ID: "2", Questions: []agent.Question{
		{Title: "Which runner?", Options: []agent.Option{{Value: "vitest", Label: "vitest"}, {Value: "jest", Label: "jest"}}, Other: true},
		{Title: "Which parts?", Options: []agent.Option{{Value: "backend", Label: "backend"}, {Value: "frontend", Label: "frontend"}}, Multiple: true},
	}})
	tt := ui.NewTester(a.View, 1100, 760)

	for _, label := range []string{"jest", "frontend", "backend"} {
		if err := tt.Click(label); err != nil {
			t.Fatal(err)
		}
	}
	if err := tt.Click("Send answer"); err != nil {
		t.Fatal(err)
	}

	if got := f.answers["a/2"]; !reflect.DeepEqual(got, [][]string{{"jest"}, {"frontend", "backend"}}) {
		t.Errorf("answered %v", got)
	}
}

func TestArchiveMovesOnAndCanBeUndone(t *testing.T) {
	a, f := testApp()
	tt := ui.NewTester(a.View, 1100, 700)

	if err := tt.Click("Archive"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if a.selected != "c" {
		t.Errorf("selected %q after archiving: the next session in the list", a.selected)
	}
	if err := tt.Click("Undo"); err != nil {
		t.Fatalf("%v; texts %q", err, tt.Texts())
	}

	if !reflect.DeepEqual(f.archived, []string{"a:on", "a:off"}) || a.selected != "a" {
		t.Errorf("archived %v, selected %q", f.archived, a.selected)
	}
}

func TestNewSessionStartsInTheChosenFolder(t *testing.T) {
	a, f := testApp()
	tt := ui.NewTester(a.View, 1100, 700)

	if err := tt.Click("New Session"); err != nil {
		t.Fatal(err)
	}

	if !reflect.DeepEqual(f.created, []string{"/code/web"}) || a.selected != "new" {
		t.Errorf("created %v, selected %q", f.created, a.selected)
	}
}

func TestFirstRunOffersToStart(t *testing.T) {
	f := &fakeAgent{events: map[string][]agent.Event{}, sent: map[string][]string{}, answers: map[string][][]string{}}
	a := New(f, func(fn func()) { fn() })
	a.async = func(fn func()) { fn() }
	a.ChooseFolder = func() (string, error) { return "/code/elsewhere", nil }
	a.setList(agent.Sessions{DefaultRoot: "/code/web"})
	tt := ui.NewTester(a.View, 1100, 700)

	if !tt.HasText("Start with a project") {
		t.Fatalf("texts %q", tt.Texts())
	}
	if err := tt.Click("New Session in web"); err != nil {
		t.Fatal(err)
	}
	// Back to none, as before the first
	a.list.Sessions, a.selected = nil, ""
	tt.Frame()
	if err := tt.Click("Choose Folder…"); err != nil {
		t.Fatal(err)
	}

	if !reflect.DeepEqual(f.created, []string{"/code/web", "/code/elsewhere"}) {
		t.Errorf("created %v", f.created)
	}
}

func TestArchivedSessionOffersToUnarchive(t *testing.T) {
	a, f := testApp()
	a.Select("d")
	tt := ui.NewTester(a.View, 1100, 700)

	if tt.HasText("Message") {
		t.Error("an archived session takes messages")
	}
	if err := tt.Click("Unarchive to go on"); err == nil {
		t.Error("the notice is not a button")
	}
	if err := tt.Click("Unarchive"); err != nil {
		t.Fatal(err)
	}

	if !reflect.DeepEqual(f.archived, []string{"d:off"}) {
		t.Errorf("archived %v", f.archived)
	}
}

func TestModeAndStopActOnTheChosenSession(t *testing.T) {
	a, f := testApp()
	a.apply(a.views["a"], agent.Event{Type: "state", State: &agent.State{ID: "a", Mode: "ask", Replying: true}})
	tt := ui.NewTester(a.View, 1100, 700)

	if err := tt.Click("Stop"); err != nil {
		t.Fatal(err)
	}
	if err := tt.Click("Mode"); err != nil {
		t.Fatal(err)
	}

	if f.modes != 1 || a.views["a"].t.State.Mode != "auto" || !reflect.DeepEqual(f.stopped, []string{"a"}) {
		t.Errorf("modes %d, mode %q, stopped %v", f.modes, a.views["a"].t.State.Mode, f.stopped)
	}
}

// TestSnapshot draws the window to a PNG, to look at: SNAPSHOT=out.png,
// DARK=1 for the dark theme, TOAST=1 once the session is archived, MENU=/th
// with the menu of commands open on what is typed.
func TestSnapshot(t *testing.T) {
	out := os.Getenv("SNAPSHOT")
	if out == "" {
		t.Skip("SNAPSHOT is not set")
	}
	a, _ := testApp()
	view := a.views["a"]
	for _, e := range []agent.Event{
		{Type: "state", State: &agent.State{ID: "a", Root: "/code/web", Model: "deepseek/deepseek-flash", Mode: "ask", Thinking: "high", ThinkingLevels: []string{"off", "high"}, Replying: true, Tools: []string{"bash", "grep", "read", "edit", "ask_user"}, Commands: testCommands}},
		{Type: "user", Text: "The login form submits twice. Find out why and fix it."},
		{Type: "thinking", Delta: "Probably a double event binding."},
		{Type: "tool_start", ID: "1", Name: "grep", Args: "{\n  \"pattern\": \"onSubmit\"\n}"},
		{Type: "tool_end", ID: "1", Name: "grep", OK: true, Output: "src/Login.tsx:14", MS: 41},
		{Type: "text", Delta: "`Login.tsx` binds `onSubmit` on the form and `onClick` on the button, so one press submits twice. I'll keep the form's handler."},
		{Type: "tool_start", ID: "2", Name: "edit", Args: "{\n  \"path\": \"src/Login.tsx\"\n}"},
		{Type: "ask", ID: "4", Tool: "edit", Questions: []agent.Question{{
			Title:   "Edit src/Login.tsx",
			Detail:  "--- src/Login.tsx\n+++ src/Login.tsx\n-  <button onClick={submit}>Sign in</button>\n+  <button type=\"submit\">Sign in</button>",
			Options: []agent.Option{{Value: "yes", Label: "Yes"}, {Value: "auto", Label: "Yes, and approve the rest inside the folder"}, {Value: "no", Label: "No"}},
		}}},
	} {
		a.apply(view, e)
	}
	a.list.Sessions[0].Status = "asking"
	a.list.Sessions[2].Status = "running"
	view.t.State.Usage = agent.UsageReading{Cost: 0.0042, Input: 12400, Output: 830, Cache: 82, Speed: 61, Calls: 3}
	view.t.State.Usage.Context = &agent.ContextSize{Tokens: 13230, Limit: 200000}
	if menu := os.Getenv("MENU"); menu != "" {
		view.draft = menu
	}
	tt := ui.NewTester(a.View, 1180, 780)
	tt.SetDark(os.Getenv("DARK") == "1")
	tt.Frame()
	if os.Getenv("TOAST") == "1" {
		// The session asks no more, so it can be archived, and the toast shows
		a.apply(view, agent.Event{Type: "ask_closed", ID: "4"})
		a.apply(view, agent.Event{Type: "state", State: &agent.State{ID: "a", Mode: "ask"}})
		tt.Frame()
		if err := tt.Click("Archive"); err != nil {
			t.Fatal(err)
		}
		tt.Frame()
	}
	// Colors fade and toasts slide in on the clock: drawn once they are done
	time.Sleep(400 * time.Millisecond)
	tt.Frame()

	f, err := os.Create(out)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err := png.Encode(f, tt.Image()); err != nil {
		t.Fatal(err)
	}
}
