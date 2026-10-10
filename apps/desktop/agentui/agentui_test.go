package agentui

import (
	"context"
	"encoding/json"
	"image/png"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/egoist/mygo/ui"
)

// fakeAgent records what the window asked of the service, and plays back
// the events each session has.
type fakeAgent struct {
	events   map[string][]Event
	followed []string
	created  []string
	sent     map[string][]string
	answers  map[string][][]string
	archived []string
	stopped  []string
	modes    int
}

func (f *fakeAgent) FollowSessions(context.Context, func(Sessions), func(error)) {}
func (f *fakeAgent) CreateSession(_ context.Context, root string) (Session, error) {
	f.created = append(f.created, root)
	return Session{ID: "new", Root: root, Updated: time.Now().UnixMilli()}, nil
}
func (f *fakeAgent) Archive(_ context.Context, id string, archived bool) (Session, error) {
	f.archived = append(f.archived, id+map[bool]string{true: ":on", false: ":off"}[archived])
	return Session{ID: id, Root: "/code/" + id, Title: "Title " + id, Archived: archived}, nil
}
func (f *fakeAgent) State(context.Context, string) (State, error) { return State{}, nil }
func (f *fakeAgent) Send(_ context.Context, id, text string) (string, error) {
	f.sent[id] = append(f.sent[id], text)
	return "started", nil
}
func (f *fakeAgent) Answer(_ context.Context, id, question string, answers [][]string) error {
	f.answers[id+"/"+question] = answers
	return nil
}
func (f *fakeAgent) Stop(_ context.Context, id string) error {
	f.stopped = append(f.stopped, id)
	return nil
}
func (f *fakeAgent) SwitchMode(_ context.Context, id string) (State, error) {
	f.modes++
	return State{ID: id, Mode: "auto"}, nil
}
func (f *fakeAgent) Think(_ context.Context, id, _ string) (State, error) { return State{ID: id}, nil }
func (f *fakeAgent) Follow(_ context.Context, id string, _ int, fn func(Event)) {
	f.followed = append(f.followed, id)
	for _, e := range f.events[id] {
		fn(e)
	}
}

// testApp runs every action at once, on the test's goroutine, with three
// sessions in two folders and one archived.
func testApp() (*App, *fakeAgent) {
	now := time.Now().UnixMilli()
	f := &fakeAgent{events: map[string][]Event{}, sent: map[string][]string{}, answers: map[string][][]string{}}
	for _, id := range []string{"a", "b", "c", "d"} {
		f.events[id] = []Event{{Type: "state", State: &State{ID: id, Root: "/code/" + id, Model: "deepseek/deepseek-flash", Mode: "ask", Thinking: "high", ThinkingLevels: []string{"off", "high"}}}}
	}
	a := NewApp(f, func(fn func()) { fn() })
	a.async = func(fn func()) { fn() }
	a.connected = true
	a.setList(Sessions{DefaultRoot: "/code/web", Sessions: []Session{
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

func TestChoosingASessionShowsIt(t *testing.T) {
	a, f := testApp()
	f.events["c"] = append(f.events["c"], Event{Type: "user", Text: "bump react to 19"}, Event{Type: "text", Delta: "Bumped."})
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
	f.events["a"] = append(f.events["a"], Event{Type: "ask", ID: "7", Tool: "bash", Questions: []Question{{
		Title:   "Run bash",
		Detail:  "pnpm test",
		Options: []Option{{Value: "yes", Label: "Yes"}, {Value: "commands", Label: "Yes, and allow every command from now on"}, {Value: "no", Label: "No"}},
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

func TestModelQuestionTakesPicksAndTypedAnswers(t *testing.T) {
	a, f := testApp()
	view := a.views["a"]
	a.apply(view, Event{Type: "ask", ID: "2", Questions: []Question{
		{Title: "Which runner?", Options: []Option{{Value: "vitest", Label: "vitest"}, {Value: "jest", Label: "jest"}}, Other: true},
		{Title: "Which parts?", Options: []Option{{Value: "backend", Label: "backend"}, {Value: "frontend", Label: "frontend"}}, Multiple: true},
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
	f := &fakeAgent{events: map[string][]Event{}, sent: map[string][]string{}, answers: map[string][][]string{}}
	a := NewApp(f, func(fn func()) { fn() })
	a.async = func(fn func()) { fn() }
	a.ChooseFolder = func() (string, error) { return "/code/elsewhere", nil }
	a.setList(Sessions{DefaultRoot: "/code/web"})
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
	a.apply(a.views["a"], Event{Type: "state", State: &State{ID: "a", Mode: "ask", Replying: true}})
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

func TestTranscriptJoinsDeltasAndEndsCalls(t *testing.T) {
	var tr Transcript
	for _, e := range []Event{
		{Type: "user", Text: "list files"},
		{Type: "thinking", Delta: "Let me "},
		{Type: "thinking", Delta: "look."},
		{Type: "tool_start", ID: "1", Name: "bash", Args: `{"command":"ls"}`},
		{Type: "tool_end", ID: "1", Name: "bash", OK: true, Output: "a.go", MS: 12},
		{Type: "text", Delta: "There is "},
		{Type: "text", Delta: "a.go."},
		{Type: "reply_end", Outcome: "done", Usage: &Usage{Input: 100, Output: 20, Cost: 0.01}},
	} {
		tr.Apply(e)
	}

	kinds := []ItemKind{}
	for _, it := range tr.Items {
		kinds = append(kinds, it.Kind)
	}
	if want := []ItemKind{KindUser, KindThinking, KindTool, KindText}; !reflect.DeepEqual(kinds, want) {
		t.Fatalf("kinds %v, want %v", kinds, want)
	}
	if tr.Items[1].Text != "Let me look." || tr.Items[3].Text != "There is a.go." {
		t.Errorf("texts %q and %q", tr.Items[1].Text, tr.Items[3].Text)
	}
	if call := tr.Items[2].Tool; !call.Done || !call.OK || call.Output != "a.go" || call.MS != 12 {
		t.Errorf("call %+v", call)
	}
	if tr.Usage != (Usage{Input: 100, Output: 20, Cost: 0.01}) {
		t.Errorf("usage %+v", tr.Usage)
	}
}

func TestTranscriptGivesBackWhatAFailedReplyWasSent(t *testing.T) {
	var tr Transcript
	tr.Apply(Event{Type: "ask", ID: "3", Questions: []Question{{Title: "Run ls"}}})
	tr.Apply(Event{Type: "ask_closed", ID: "3"})
	unfinished := tr.Apply(Event{Type: "reply_end", Outcome: "failed", Error: "rate limited", Unsent: "list files"})

	if !unfinished || tr.Unsent != "list files" {
		t.Errorf("unfinished %v, unsent %q", unfinished, tr.Unsent)
	}
	if tr.Asking != nil {
		t.Errorf("asking %+v after it closed", tr.Asking)
	}
	if last := tr.Items[len(tr.Items)-1]; !last.Failed || !strings.Contains(last.Text, "rate limited") {
		t.Errorf("notice %+v", last)
	}
}

func TestReadEventsParsesTheStream(t *testing.T) {
	stream := ": ping\n\nid: 1\ndata: {\"seq\":1,\"type\":\"text\",\"delta\":\"hi\"}\n\nid: 2\ndata: {\"seq\":2,\"type\":\"reply_end\"}\n\n"
	var got []Event
	err := readEvents(strings.NewReader(stream), func(raw json.RawMessage) {
		var e Event
		_ = json.Unmarshal(raw, &e)
		got = append(got, e)
	})

	if len(got) != 2 || got[0].Delta != "hi" || got[1].Type != "reply_end" {
		t.Errorf("events %+v", got)
	}
	if err == nil {
		t.Error("a stream that ends is a drop, to connect again after")
	}
}

func TestShortPathKeepsTheFolderName(t *testing.T) {
	home, _ := os.UserHomeDir()
	for path, want := range map[string]string{
		"/code/web":             "/code/web",
		home + "/projects/shop": "~/projects/shop",
		"/private/tmp/claude-501/-Users-xiang-projects/scratchpad/verify/billing-api": "…/scratchpad/verify/billing-api",
	} {
		if got := shortPath(path); got != want {
			t.Errorf("shortPath(%q) = %q, want %q", path, got, want)
		}
	}
}

func TestAgoIsBrief(t *testing.T) {
	now := time.Date(2026, 10, 10, 12, 0, 0, 0, time.UTC)
	for _, c := range []struct {
		before time.Duration
		want   string
	}{{10 * time.Second, "now"}, {5 * time.Minute, "5m"}, {3 * time.Hour, "3h"}, {50 * time.Hour, "2d"}, {30 * 24 * time.Hour, "Sep 10"}} {
		if got := ago(now.Add(-c.before).UnixMilli(), now); got != c.want {
			t.Errorf("%v ago: %q, want %q", c.before, got, c.want)
		}
	}
}

// TestSnapshot draws the window to a PNG, to look at: SNAPSHOT=out.png,
// DARK=1 for the dark theme, TOAST=1 once the session is archived.
func TestSnapshot(t *testing.T) {
	out := os.Getenv("SNAPSHOT")
	if out == "" {
		t.Skip("SNAPSHOT is not set")
	}
	a, _ := testApp()
	view := a.views["a"]
	for _, e := range []Event{
		{Type: "state", State: &State{ID: "a", Root: "/code/web", Model: "deepseek/deepseek-flash", Mode: "ask", Thinking: "high", ThinkingLevels: []string{"off", "high"}, Replying: true, Tools: []string{"bash", "grep", "read", "edit", "ask_user"}}},
		{Type: "user", Text: "The login form submits twice. Find out why and fix it."},
		{Type: "thinking", Delta: "Probably a double event binding."},
		{Type: "tool_start", ID: "1", Name: "grep", Args: "{\n  \"pattern\": \"onSubmit\"\n}"},
		{Type: "tool_end", ID: "1", Name: "grep", OK: true, Output: "src/Login.tsx:14", MS: 41},
		{Type: "text", Delta: "`Login.tsx` binds `onSubmit` on the form and `onClick` on the button, so one press submits twice. I'll keep the form's handler."},
		{Type: "tool_start", ID: "2", Name: "edit", Args: "{\n  \"path\": \"src/Login.tsx\"\n}"},
		{Type: "ask", ID: "4", Tool: "edit", Questions: []Question{{
			Title:   "Edit src/Login.tsx",
			Detail:  "--- src/Login.tsx\n+++ src/Login.tsx\n-  <button onClick={submit}>Sign in</button>\n+  <button type=\"submit\">Sign in</button>",
			Options: []Option{{Value: "yes", Label: "Yes"}, {Value: "auto", Label: "Yes, and approve the rest inside the folder"}, {Value: "no", Label: "No"}},
		}}},
	} {
		a.apply(view, e)
	}
	a.list.Sessions[0].Status = "asking"
	a.list.Sessions[2].Status = "running"
	view.t.Usage = Usage{Input: 12400, Output: 830, Cost: 0.0042}
	tt := ui.NewTester(a.View, 1180, 780)
	tt.SetDark(os.Getenv("DARK") == "1")
	tt.Frame()
	if os.Getenv("TOAST") == "1" {
		// The session asks no more, so it can be archived, and the toast shows
		a.apply(view, Event{Type: "ask_closed", ID: "4"})
		a.apply(view, Event{Type: "state", State: &State{ID: "a", Mode: "ask"}})
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
