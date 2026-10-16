package app

import (
	"context"
	"errors"
	"fmt"
	"image/png"
	"math"
	"os"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/egoist/mygo/ui"

	"desktop/agent"
	"desktop/syntax"
	"desktop/ui/components"
)

// fakeAgent records what the window asked of the service, and plays back
// the events each session has.
type fakeAgent struct {
	events   map[string][]agent.Event
	followed []string
	created  []string
	// The model each session was created on, in turn
	createdOn []string
	sent      map[string][]string
	commands  map[string][]string
	answers   map[string][][]string
	archived  []string
	stopped   []string
	modes     int
	// What every session was set to, in turn
	everyMode []string
	// Where each session followed takes its events after those played back
	live map[string]func(agent.Event)
	// The models each session was switched to, in turn
	models map[string][]string
	// The providers as changed, testProviders until then; the keys stored,
	// the endpoints kept and removed, and what the probe finds.
	providers []agent.Provider
	keys      map[string]string
	endpoints []agent.Endpoint
	removed   []string
	probed    []string
}

func (f *fakeAgent) FollowSessions(context.Context, func(agent.Sessions), func(error)) {}
func (f *fakeAgent) CreateSession(_ context.Context, root, model string) (agent.Session, error) {
	f.created = append(f.created, root)
	f.createdOn = append(f.createdOn, model)
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
func (f *fakeAgent) SetMode(_ context.Context, id, mode string) (agent.State, error) {
	f.modes++
	return agent.State{ID: id, Mode: mode}, nil
}
func (f *fakeAgent) SetModes(_ context.Context, mode string) error {
	f.everyMode = append(f.everyMode, mode)
	return nil
}
func (f *fakeAgent) Think(_ context.Context, id, _ string) (agent.State, error) {
	return agent.State{ID: id}, nil
}
func (f *fakeAgent) UseModel(_ context.Context, id, model string) (agent.State, error) {
	if f.models == nil {
		f.models = map[string][]string{}
	}
	f.models[id] = append(f.models[id], model)
	return agent.State{ID: id, Model: model, Mode: "ask"}, nil
}
func (f *fakeAgent) Providers(context.Context) ([]agent.Provider, error) {
	return f.listed(), nil
}
func (f *fakeAgent) listed() []agent.Provider {
	if f.providers == nil {
		f.providers = append([]agent.Provider{}, testProviders...)
	}
	return f.providers
}
func (f *fakeAgent) StoreKey(_ context.Context, provider, key string) ([]agent.Provider, error) {
	if f.keys == nil {
		f.keys = map[string]string{}
	}
	f.keys[provider] = key
	for i, p := range f.listed() {
		if p.ID == provider {
			f.providers[i].Detected, f.providers[i].Stored, f.providers[i].Source = true, true, "stored credential"
		}
	}
	return f.providers, nil
}
func (f *fakeAgent) ForgetKey(_ context.Context, provider string) ([]agent.Provider, error) {
	f.removed = append(f.removed, provider)
	for i, p := range f.listed() {
		if p.ID == provider {
			f.providers[i].Detected, f.providers[i].Stored, f.providers[i].Source = false, false, ""
		}
	}
	return f.providers, nil
}
func (f *fakeAgent) KeepEndpoint(_ context.Context, e agent.Endpoint) ([]agent.Provider, error) {
	f.endpoints = append(f.endpoints, e)
	id := e.ID
	if id == "" {
		id = strings.ReplaceAll(strings.ToLower(e.Name), " ", "-")
	}
	kept := e
	kept.Key = ""
	f.providers = append(f.listed(), agent.Provider{ID: id, Name: e.Name, Detected: true, Source: "no key", APIKey: true, Models: len(e.Models), Endpoint: &kept})
	return f.providers, nil
}
func (f *fakeAgent) RemoveEndpoint(_ context.Context, id string) ([]agent.Provider, error) {
	f.removed = append(f.removed, id)
	var left []agent.Provider
	for _, p := range f.listed() {
		if p.ID != id {
			left = append(left, p)
		}
	}
	f.providers = left
	return left, nil
}
func (f *fakeAgent) ProbeEndpoint(_ context.Context, baseURL, _, _ string) ([]string, error) {
	if f.probed == nil {
		return nil, fmt.Errorf("could not reach %s/models: ECONNREFUSED", baseURL)
	}
	return f.probed, nil
}
func (f *fakeAgent) Models(_ context.Context, provider string) ([]agent.Model, error) {
	return testModels[provider], nil
}
func (f *fakeAgent) Follow(_ context.Context, id string, _ int, fn func(agent.Event)) {
	f.followed = append(f.followed, id)
	for _, e := range f.events[id] {
		fn(e)
	}
	if f.live == nil {
		f.live = map[string]func(agent.Event){}
	}
	f.live[id] = fn
}

// testProviders are the catalog's providers, two of them detected.
var testProviders = []agent.Provider{
	{ID: "deepseek", Name: "DeepSeek", Detected: true, Source: "DEEPSEEK_API_KEY", Login: true, APIKey: true, Models: 2},
	{ID: "groq", Name: "Groq", Detected: true, Source: "stored credential", Login: true, APIKey: true, Stored: true, Models: 2},
	{ID: "openai", Name: "OpenAI", Login: true, APIKey: true, OAuth: true, Models: 44},
	{ID: "amazon-bedrock", Name: "Amazon Bedrock", Models: 185},
}

var testModels = map[string][]agent.Model{
	"deepseek": {{ID: "deepseek-flash", Name: "DeepSeek Flash", ContextWindow: 128000}, {ID: "deepseek-v4-pro", Name: "DeepSeek V4 Pro", ContextWindow: 128000, Reasoning: true}},
	"groq":     {{ID: "llama-4-scout", Name: "Llama 4 Scout", ContextWindow: 131072}, {ID: "qwen3-32b", Name: "Qwen3 32B", ContextWindow: 131072}},
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

func init() {
	syntax.Background = func(fn func()) { fn() }
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
	a.after = func(_ time.Duration, fn func()) { fn() }
	a.link.up = true
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

// The session shown takes in its events on the next tick, one not shown
// now and then; either all of those come meanwhile at once, and one not
// shown all of them as it is shown.
func TestABackgroundSessionTakesInItsEventsLater(t *testing.T) {
	a, f := testApp()
	a.Select("b")
	a.Select("a")
	var later []func()
	var waits []time.Duration
	a.after = func(d time.Duration, fn func()) {
		later = append(later, fn)
		waits = append(waits, d)
	}

	for _, word := range []string{"shown ", "too"} {
		f.live["a"](agent.Event{Type: "text", Delta: word})
	}
	for _, word := range []string{"one ", "two ", "three"} {
		f.live["b"](agent.Event{Type: "text", Delta: word})
	}
	if len(a.views["a"].t.Items) != 0 || len(a.views["b"].t.Items) != 0 || len(later) != 2 ||
		waits[0] > components.Tick || waits[1] != backgroundEvery {
		t.Fatalf("the one shown has %d items, the other %d; updates after %v", len(a.views["a"].t.Items), len(a.views["b"].t.Items), waits)
	}
	later[0]()
	if items := a.views["a"].t.Items; len(items) != 1 || items[0].Text != "shown too" || len(a.views["b"].t.Items) != 0 {
		t.Fatalf("shown, on the tick: %+v", items)
	}
	later[1]()
	if items := a.views["b"].t.Items; len(items) != 1 || items[0].Text != "one two three" {
		t.Fatalf("taken in later: %+v", items)
	}

	f.live["b"](agent.Event{Type: "text", Delta: "!"})
	a.Select("b")
	if items := a.views["b"].t.Items; items[0].Text != "one two three!" {
		t.Errorf("shown: %q", items[0].Text)
	}
}

// Past keptViews, the window lets go of the idle sessions shown longest
// ago, but keeps one waiting on an answer or with something typed.
func TestIdleSessionsAreLetGo(t *testing.T) {
	a, _ := testApp()
	var sessions []agent.Session
	for i := range keptViews + 3 {
		sessions = append(sessions, agent.Session{ID: fmt.Sprint(i), Root: "/code/web"})
	}
	sessions[1].Status = "asking"
	a.setList(agent.Sessions{Sessions: sessions})

	for _, s := range sessions {
		a.Select(s.ID)
		if s.ID == "0" {
			a.views["0"].draft = "half typed"
		}
	}

	if a.views["a"] != nil {
		t.Error("the idle session shown first is still followed")
	}
	for _, s := range sessions {
		if a.views[s.ID] == nil {
			t.Errorf("session %s was let go of", s.ID)
		}
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

func TestInspectorShowsAStepAndStepsThroughThem(t *testing.T) {
	a, _ := testApp()
	view := a.views["a"]
	for _, e := range []agent.Event{
		{Type: "user", Text: "find the form"},
		{Type: "tool_start", ID: "1", Name: "grep", Args: `{"pattern":"onSubmit"}`},
		{Type: "tool_end", ID: "1", OK: true, Output: "src/Login.tsx:14", MS: 40},
		{Type: "tool_start", ID: "2", Name: "bash", Args: `{"command":"pnpm test"}`},
		{Type: "tool_end", ID: "2", OK: true, Output: "1 passed", MS: 900},
		{Type: "text", Delta: "Found it."},
	} {
		a.apply(view, e)
	}
	tt := ui.NewTester(a.View, 1180, 700)

	// Folded: the work is one line, its steps out of sight
	if !tt.HasText(`Searched for "onSubmit", ran pnpm test`) || tt.HasText("src/Login.tsx:14") {
		t.Fatalf("texts %q", tt.Texts())
	}
	if err := tt.Click(`Searched for "onSubmit", ran pnpm test`); err != nil {
		t.Fatal(err)
	}
	// The steps unfold before they take a click
	tt.Advance(time.Second)
	if err := tt.Click("Show grep"); err != nil {
		t.Fatal(err)
	}
	if view.t.Inspected != view.t.Steps[0] || !tt.HasText("src/Login.tsx:14") || !tt.HasText("1 of 2") {
		t.Fatalf("inspected %+v, texts %q", view.t.Inspected, tt.Texts())
	}

	// The step shown, clicked again, closes the inspector in that frame
	if err := tt.Click("Show grep"); err != nil {
		t.Fatal(err)
	}
	if view.t.Inspected != nil || tt.HasText("1 of 2") {
		t.Fatalf("after a second click, inspected %+v", view.t.Inspected)
	}
	if err := tt.Click("Show grep"); err != nil {
		t.Fatal(err)
	}

	tt.Key(0, ui.KeyDown)
	if view.t.Inspected != view.t.Steps[1] || !tt.HasText("1 passed") {
		t.Errorf("after Down, inspected %+v", view.t.Inspected)
	}
	tt.Key(0, ui.KeyEscape)
	if view.t.Inspected != nil || tt.HasText("1 passed") {
		t.Errorf("after Esc, inspected %+v", view.t.Inspected)
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
	a.regroup()
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
// with the menu of commands open on what is typed, APPROVALS=yolo with
// that mode chosen in the settings, USAGE=1 with the history 3/4 full and
// what was spent open, COMPACT=1 with a compaction done and one running,
// MODELS=1 with the picker of models open, SCALE=2 drawn at twice the size,
// VIBRANCY=1 over the window's material, left transparent, as much as
// CONTENT_TRANSPARENCY=<0 to 100> lets through. In the settings, PAGE=approvals
// or models shows that page, which the following imply: ENDPOINT=1
// adds an endpoint to the providers, REMOVING=<id> asks to remove one,
// and ADDING=list, key or endpoint opens the form there, PROBLEM=<text>
// saying what went wrong in the endpoint's.
func TestSnapshot(t *testing.T) {
	out := os.Getenv("SNAPSHOT")
	if out == "" {
		t.Skip("SNAPSHOT is not set")
	}
	a, fake := testApp()
	view := a.views["a"]
	for _, e := range []agent.Event{
		{Type: "state", State: &agent.State{ID: "a", Root: "/code/web", Model: "deepseek/deepseek-flash", Mode: "ask", Thinking: "high", ThinkingLevels: []string{"off", "high"}, Replying: true, Tools: []string{"bash", "grep", "read", "edit", "ask_user"}, Commands: testCommands}},
		{Type: "user", Text: "The login form submits twice. Find out why and fix it."},
		{Type: "thinking", Delta: "Probably a **double event binding**:\n\n- `onSubmit` on the form\n- `onClick` on the button\n\nLet me find where the form submits."},
		{Type: "tool_start", ID: "1", Name: "grep", Args: "{\n  \"pattern\": \"onSubmit\"\n}"},
		{Type: "tool_end", ID: "1", Name: "grep", OK: true, Output: "src/Login.tsx:14\nsrc/Form.tsx:31", MS: 41},
		{Type: "tool_start", ID: "2", Name: "read", Args: "{\n  \"path\": \"/code/web/src/Login.tsx\"\n}"},
		{Type: "tool_end", ID: "2", Name: "read", OK: true, Output: "export function Login() {\n  const submit = useSubmit()\n  return (\n    <form onSubmit={submit}>\n      <button onClick={submit}>Sign in</button>\n    </form>\n  )\n}", MS: 12},
		{Type: "tool_start", ID: "3", Name: "read", Args: "{\n  \"path\": \"/code/web/src/Form.tsx\"\n}"},
		{Type: "tool_end", ID: "3", Name: "read", OK: true, Output: "…", MS: 9},
		{Type: "tool_start", ID: "4", Name: "bash", Args: "{\n  \"command\": \"pnpm test login\"\n}"},
		{Type: "tool_end", ID: "4", Name: "bash", OK: false, Output: "FAIL src/Login.test.tsx\n  expected submit to be called 1 time, but it was called 2 times", MS: 2140},
		{Type: "text", Delta: "`Login.tsx` binds `onSubmit` on the form and `onClick` on the button, so one press submits twice, as the failing test shows:\n\n```tsx\n<form onSubmit={submit}>\n  {/* both run on a press */}\n  <button onClick={submit}>Sign in</button>\n</form>\n```\n\nI'll keep the form's handler."},
		{Type: "tool_start", ID: "5", Name: "edit", Args: "{\"path\":\"/code/web/src/Login.tsx\",\"edits\":[{\"old_text\":\"      <button onClick={submit}>Sign in</button>\\n\",\"new_text\":\"      <button type=\\\"submit\\\">Sign in</button>\\n\"}]}"},
		{Type: "tool_end", ID: "5", Name: "edit", OK: true, Output: "Edited src/Login.tsx", MS: 6},
		{Type: "tool_start", ID: "6", Name: "bash", Args: "{\n  \"command\": \"pnpm test login\"\n}"},
		{Type: "tool_end", ID: "6", Name: "bash", OK: true, Output: "PASS src/Login.test.tsx\n  ✓ submits once (18 ms)\n\nTests  1 passed", MS: 1870},
		{Type: "text", Delta: "Fixed: the button is now `type=\"submit\"`, so the form's handler runs once. The login test passes.\n\n### What changed\n\n1. **Login.tsx**: the button submits the form; its `onClick` is gone.\n2. *Login.test.tsx*: a test for a double click.\n\n> The other forms bind only `onSubmit`, as [React's guide](https://react.dev/reference/react-dom/components/form) does.\n\n| File | Lines |\n|---|--:|\n| src/Login.tsx | 1 |\n| src/Login.test.tsx | 4 |\n\n- [x] The login test passes\n- [ ] Check the signup form"},
		{Type: "user", Text: "Also cover the double click in a test."},
		{Type: "thinking", Delta: "A test that clicks twice quickly."},
		{Type: "tool_start", ID: "7", Name: "edit", Args: "{\n  \"path\": \"src/Login.test.tsx\"\n}"},
		{Type: "ask", ID: "4", Tool: "edit", Questions: []agent.Question{{
			Title:   "Edit src/Login.test.tsx",
			Detail:  "--- src/Login.test.tsx\n+++ src/Login.test.tsx\n+  it('submits once on a double click', async () => {\n+    await user.dblClick(button)\n+    expect(submit).toHaveBeenCalledTimes(1)\n+  })",
			Options: []agent.Option{{Value: "yes", Label: "Yes"}, {Value: "auto", Label: "Yes, and approve the rest inside the folder"}, {Value: "no", Label: "No"}},
		}}},
	} {
		if os.Getenv("COMPACT") == "1" && e.Text == "Also cover the double click in a test." {
			a.apply(view, agent.Event{Type: "compacting", Tokens: 182_400})
			a.apply(view, agent.Event{Type: "compacted", Before: 182_400, After: 31_200})
		}
		a.apply(view, e)
	}
	if os.Getenv("COMPACT") == "1" {
		a.apply(view, agent.Event{Type: "ask_closed", ID: "4"})
		a.apply(view, agent.Event{Type: "compacting", Tokens: 164_000})
	}
	a.list.Sessions[0].Status = "asking"
	a.list.Sessions[2].Status = "running"
	view.t.State.Usage = agent.UsageReading{Cost: 0.0042, Input: 12400, Output: 830, Cache: 82, Speed: 61, Calls: 3}
	view.t.State.Usage.Context = &agent.ContextSize{Tokens: 13230, Limit: 200000}
	if os.Getenv("USAGE") == "1" {
		view.t.State.Usage = agent.UsageReading{Cost: 0.6621, Input: 16_000_000, Output: 425_000, Cache: 99, Speed: 48, Calls: 120}
		view.t.State.Usage.Context = &agent.ContextSize{Tokens: 149_000, Limit: 200_000}
		view.usageOpen = true
	}
	if menu := os.Getenv("MENU"); menu != "" {
		view.draft = menu
	}
	a.Settings.Theme = os.Getenv("THEME")
	a.Settings.Approvals = os.Getenv("APPROVALS")
	a.Settings.Model = os.Getenv("DEFAULT_MODEL")
	if v, err := strconv.ParseFloat(os.Getenv("TRANSPARENCY"), 64); err == nil {
		a.Settings.Transparency = v
	}
	if v, err := strconv.ParseFloat(os.Getenv("CONTENT_TRANSPARENCY"), 64); err == nil {
		a.Settings.ContentTransparency = v
	}
	if os.Getenv("SETTINGS") == "1" {
		a.settingsPage = os.Getenv("PAGE")
		if os.Getenv("ADDING")+os.Getenv("ENDPOINT")+os.Getenv("REMOVING")+os.Getenv("OTHERS") != "" {
			a.settingsPage = pageModels
		}
		a.OpenSettings()
		a.othersOpen = os.Getenv("OTHERS") == "1"
		if os.Getenv("ENDPOINT") == "1" {
			fake.providers = append(append([]agent.Provider{}, testProviders...), agent.Provider{
				ID: "ollama", Name: "Ollama", Detected: true, Source: "no key", APIKey: true, Models: 3,
				Endpoint: &agent.Endpoint{BaseURL: "http://localhost:11434/v1", Models: []agent.EndpointModel{{ID: "qwen2.5-coder:14b"}}},
			})
			a.loadProviders()
		}
		a.removing = os.Getenv("REMOVING")
		switch os.Getenv("ADDING") {
		case "list":
			a.openProviderForm(&providerForm{})
		case "key":
			a.keyForm("openai")
		case "endpoint":
			a.openProviderForm(&providerForm{chosen: true, listed: true, name: "Ollama", baseURL: "http://localhost:11434/v1",
				models:  []modelChoice{{"deepseek-r1:14b", true}, {"llama3.1:8b", false}, {"qwen2.5-coder:14b", true}},
				problem: os.Getenv("PROBLEM")})
		}
	}
	if os.Getenv("MODELS") == "1" {
		view.models = modelPicker{open: true, provider: "deepseek"}
		a.loadProviders()
		a.loadModels("deepseek")
	}
	if os.Getenv("OPEN") == "1" {
		view.t.Blocks[1].Work.Open = true
	}
	if os.Getenv("INSPECT") == "1" {
		step := 2
		if n, err := strconv.Atoi(os.Getenv("STEP")); err == nil {
			step = n
		}
		view.t.Inspected = view.t.Steps[step]
	}
	height := 780
	if h, err := strconv.Atoi(os.Getenv("HEIGHT")); err == nil {
		height = h
	}
	tt := ui.NewTester(a.View, 1180, height)
	tt.SetDark(os.Getenv("DARK") == "1")
	tt.SetVibrancy(os.Getenv("VIBRANCY") == "1")
	if s, err := strconv.ParseFloat(os.Getenv("SCALE"), 32); err == nil {
		tt.SetScale(float32(s))
	}
	// The traffic lights of a hidden-inset title bar, as on macOS
	tt.SetTitleBar(ui.TitleBar{Height: TitleBarHeight, Left: 78})
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
	// Colors fade and toasts slide in on the Tester's clock: drawn once they
	// are done
	tt.Advance(400 * time.Millisecond)
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

// The transparency slider snaps by its step as it is dragged; what it
// sets is kept once it is let go.
func TestSettingsTransparencySnapsAndKeeps(t *testing.T) {
	a, _ := testApp()
	var saved []Settings
	a.SaveSettings = func(s Settings) { saved = append(saved, s) }
	tt := ui.NewTester(a.View, 1100, 700)
	a.OpenSettings()
	tt.Frame()

	// The knob is 20 wide, its center 10 below the slider's top, which is
	// 28 tall over the names of its ends
	solid, _ := tt.Find("Solid")
	clear, _ := tt.Find("Clear")
	left, right := solid.X+10, clear.X+clear.W-10
	y := solid.Y - 2 - 28 + 10
	along := func(v float32) float32 { return left + (right-left)*v/100 }
	kept := len(saved)

	tt.Press(along(50), y)
	tt.Move(along(73), y)
	tt.Frame()
	if a.Settings.Transparency != 70 {
		t.Errorf("transparency %v: 73 snaps to 70", a.Settings.Transparency)
	}
	if len(saved) != kept {
		t.Errorf("saved %v while dragging", saved[kept:])
	}
	tt.Move(along(98), y)
	tt.Release(along(98), y)
	tt.Frame()
	if a.Settings.Transparency != transparencyClear || len(saved) == kept || saved[len(saved)-1].Transparency != transparencyClear {
		t.Errorf("transparency %v, saved %v: let go at 98, clear is kept", a.Settings.Transparency, saved[kept:])
	}

	tt.Key(0, ui.KeyLeft)
	tt.Frame()
	if a.Settings.Transparency != 90 {
		t.Errorf("transparency %v: the arrows step", a.Settings.Transparency)
	}
}

// The sidebar and the bars at the standard transparency are as the window
// was before it could be chosen, solid covers what is behind it, and in between it goes
// straight from one detent to the next.
func TestGlassesRampThroughTheDetents(t *testing.T) {
	for name, r := range map[string]ramp{"sidebar": glasses.sidebar, "sidebar light": glasses.sidebarLight, "selection": glasses.selection, "bar": glasses.bar, "content": glasses.content, "content light": glasses.contentLight} {
		if r.clear > r.standard || r.standard > r.solid {
			t.Errorf("%s: %v, a clearer glass covers more", name, r)
		}
	}
	if glasses.sidebar.at(transparencyStandard) != 0.6 || glasses.bar.at(transparencyStandard) != scrollEdgeCover {
		t.Error("standard is not the window as it was")
	}
	// The light material is washed pale already, so its veil is thinner
	// for as much of the desktop to show as in the dark
	if glasses.sidebarLight.at(transparencyStandard) >= glasses.sidebar.at(transparencyStandard) {
		t.Error("the light sidebar covers as much as the dark")
	}
	if glasses.sidebar.at(transparencySolid) != 1 || glasses.sidebarLight.at(transparencySolid) != 1 || glasses.bar.at(transparencySolid) != 1 || glasses.selection.at(transparencySolid) != 1 ||
		glasses.content.at(transparencySolid) != 1 || glasses.contentLight.at(transparencySolid) != 1 {
		t.Error("solid lets something through")
	}
	if got := glasses.sidebar.at(75); math.Abs(float64(got)-0.3) > 1e-6 {
		t.Errorf("sidebar at 75: %v, want 0.3", got)
	}
	if got := glasses.bar.at(-10); got != 1 {
		t.Errorf("bar below solid: %v, want 1", got)
	}
}

// The settings show in place of the session, a page at a time; a choice
// shows at once and is kept, and the way back says how many sessions wait.
func TestSettingsChooseAppearanceAndTheme(t *testing.T) {
	a, _ := testApp()
	var saved []Settings
	a.SaveSettings = func(s Settings) { saved = append(saved, s) }
	tt := ui.NewTester(a.View, 1100, 700)
	tt.SetDark(false)
	tt.Frame()

	if err := tt.Click("Settings"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if !tt.HasText("Appearance") || !tt.HasText("Follows macOS, which is light now.") {
		t.Fatalf("no settings in %q", tt.Texts())
	}

	if err := tt.Click("Dark"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if a.Settings.Appearance != components.Dark || !a.theme.Dark || !tt.HasText("Always dark") {
		t.Errorf("appearance %q, dark %v: Dark makes the window dark while the system is light", a.Settings.Appearance, a.theme.Dark)
	}

	if err := tt.Click("Lagoon theme"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if a.Settings.Theme != "Lagoon" || components.PaletteOf(a.theme).Primary != components.SchemeNamed("Lagoon").Dark.Primary {
		t.Errorf("theme %q: Lagoon draws the window", a.Settings.Theme)
	}
	if want := (Settings{Appearance: components.Dark, Theme: "Lagoon", Transparency: transparencyStandard, ContentTransparency: transparencyStandard}); len(saved) == 0 || saved[len(saved)-1] != want {
		t.Errorf("saved %v, want last %v", saved, want)
	}

	tt.Key(0, ui.KeyEscape)
	tt.Frame()
	if a.settingsOpen {
		t.Error("Escape leaves the settings open")
	}

	a.OpenSettings()
	tt.Frame()
	if err := tt.Click("Approvals"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if tt.HasText("Color theme") || !tt.HasText("Nothing waits for a yes.") {
		t.Errorf("the Approvals page shows %q", tt.Texts())
	}
	if _, ok := tt.Find("1 waiting"); !ok || tt.HasText("Fix the login form") {
		t.Errorf("the settings' sidebar shows %q: the way back, with the session that asks counted", tt.Texts())
	}

	if err := tt.Click("Back to the sessions"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if a.settingsOpen || a.selected != "a" || !tt.HasText("Fix the login form") {
		t.Errorf("open %v, selected %q: the way back shows the session as it was", a.settingsOpen, a.selected)
	}
	a.OpenSettings()
	tt.Frame()
	if !tt.HasText("Nothing waits for a yes.") {
		t.Errorf("the settings open again on %q, not the page shown last", tt.Texts())
	}
}

func TestApprovalsSetEverySessionAndYoloIsLeftForAsk(t *testing.T) {
	a, f := testApp()
	tt := ui.NewTester(a.View, 1100, 1000)
	a.settingsPage = pageApprovals
	a.OpenSettings()
	tt.Frame()

	if !tt.HasText("None chosen: each session starts as the service does, in ask unless it was started with --yolo.") {
		t.Errorf("no note while none is chosen in %q", tt.Texts())
	}
	if err := tt.Click("yolo"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if a.Settings.Approvals != "yolo" || !reflect.DeepEqual(f.everyMode, []string{"yolo"}) {
		t.Errorf("approvals %q, set %v: choosing yolo sets every session to it", a.Settings.Approvals, f.everyMode)
	}
	if !tt.HasText("Commands run and files change unseen, outside the folder too.") {
		t.Errorf("yolo chosen says nothing of what it lets through in %q", tt.Texts())
	}

	// Connected again, the service perhaps started again, so the mode is set again
	a.link.set(nil)
	a.applyApprovals()
	if !reflect.DeepEqual(f.everyMode, []string{"yolo", "yolo"}) {
		t.Errorf("set %v", f.everyMode)
	}

	a.Select("a")
	a.apply(a.views["a"], agent.Event{Type: "state", State: &agent.State{ID: "a", Mode: "yolo"}})
	tt.Frame()
	if err := tt.Click("Mode"); err != nil {
		t.Fatal(err)
	}
	if a.views["a"].t.State.Mode != "ask" {
		t.Errorf("mode %q: the status line takes a session out of yolo, back to ask", a.views["a"].t.State.Mode)
	}
}

// A scheme's stylesheet saved shows in the next frame; one that does not
// read leaves the schemes as they were, and says what is wrong.
func TestSchemesChangeAsTheyAreSaved(t *testing.T) {
	a, _ := testApp()
	builtIn := components.Schemes
	defer func() { components.Schemes = builtIn }()
	tester := ui.NewTester(a.View, 1000, 700)
	tester.Frame()

	edited := *builtIn[0]
	edited.Light.Background = ui.Hex("#ffeedd")
	a.SchemesChanged([]*components.Scheme{&edited}, nil)
	tester.Frame()
	if got := components.PaletteOf(a.theme).Background; got != edited.Light.Background {
		t.Errorf("background %+v, want the edited %+v", got, edited.Light.Background)
	}

	a.SchemesChanged(nil, errors.New("schemes/forest.css: :root: missing --foreground"))
	if a.toast == nil || !strings.Contains(a.toast.message, "missing --foreground") || len(components.Schemes) != 1 {
		t.Errorf("toast %+v, schemes %d", a.toast, len(components.Schemes))
	}
}
