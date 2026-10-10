package agentui

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/egoist/mygo/ui"
)

func TestCommandMenuRanksAsTheTerminalDoes(t *testing.T) {
	names := func(draft string) []string {
		var out []string
		for _, e := range commandMenu(testCommands, draft) {
			out = append(out, e.completion())
		}
		return out
	}
	for _, c := range []struct {
		draft string
		want  []string
	}{
		// Every command for a `/`, in the service's order
		{"/", []string{"/think ", "/fast ", "/compact", "/help", "/exit", "/login ", "/impeccable "}},
		// Names that start with it, then names that have it, then hints that do
		{"/co", []string{"/compact", "/help"}},
		{"/in", []string{"/think ", "/login ", "/impeccable "}},
		// Past the name, what it takes
		{"/think ", []string{"/think off", "/think high"}},
		{"/login open", []string{"/login openai", "/login openai-codex"}},
		{"/login ai", []string{"/login openai", "/login openai-codex"}},
		// Nothing for a command that takes no choices, a message, or none that matches
		{"/impeccable ", nil},
		{"hello /th", nil},
		{"/zz", nil},
		{"/think high now", nil},
	} {
		if got := names(c.draft); !reflect.DeepEqual(got, c.want) {
			t.Errorf("%q: %q, want %q", c.draft, got, c.want)
		}
	}
}

func TestEnterCompletesACommandThenRunsItsChoice(t *testing.T) {
	a, f := testApp()
	tt := ui.NewTester(a.View, 1100, 700)
	if err := tt.Click("Message"); err != nil {
		t.Fatal(err)
	}

	tt.Type("/thi")
	tt.Frame()
	if !tt.HasText("sets thinking") || !tt.HasText("1 of 1") {
		t.Fatalf("no menu: %q", tt.Texts())
	}
	tt.Key(0, ui.KeyEnter)
	tt.Frame()
	if got := a.views["a"].draft; got != "/think " {
		t.Fatalf("draft %q after Enter, want the command and a space", got)
	}
	// The caret is at the end of the completion: what is typed next narrows the choices
	tt.Type("hi")
	tt.Frame()
	if got := a.views["a"].draft; got != "/think hi" {
		t.Fatalf("draft %q, want the typing after the completion", got)
	}
	tt.Key(0, ui.KeyEnter)
	tt.Frame()

	if got := f.commands["a"]; !reflect.DeepEqual(got, []string{"/think high"}) {
		t.Errorf("ran %q", got)
	}
	if a.views["a"].draft != "" {
		t.Errorf("draft %q after running", a.views["a"].draft)
	}
}

func TestArrowsChooseAndGoRound(t *testing.T) {
	a, f := testApp()
	tt := ui.NewTester(a.View, 1100, 700)
	if err := tt.Click("Message"); err != nil {
		t.Fatal(err)
	}

	tt.Type("/think ")
	tt.Key(0, ui.KeyUp)
	tt.Key(0, ui.KeyEnter)

	if got := f.commands["a"]; !reflect.DeepEqual(got, []string{"/think high"}) {
		t.Errorf("ran %q, want the last choice after Up from the first", got)
	}
}

func TestTabCompletesAndEscClosesTheMenu(t *testing.T) {
	a, f := testApp()
	tt := ui.NewTester(a.View, 1100, 700)
	if err := tt.Click("Message"); err != nil {
		t.Fatal(err)
	}

	tt.Type("/comp")
	tt.Key(0, ui.KeyTab)
	tt.Frame()
	if got := a.views["a"].draft; got != "/compact" {
		t.Fatalf("draft %q after Tab", got)
	}
	tt.Key(0, ui.KeyEscape)
	tt.Frame()
	if tt.HasText("summarizes the conversation so far") {
		t.Error("the menu is still open after Esc")
	}
	// Closed, Enter sends the line it names
	tt.Key(0, ui.KeyEnter)
	if got := f.commands["a"]; !reflect.DeepEqual(got, []string{"/compact"}) {
		t.Errorf("ran %q", got)
	}
}

func TestMessagesAndSkillsGoTheirWays(t *testing.T) {
	a, f := testApp()
	quit := 0
	a.Quit = func() { quit++ }
	view := a.views["a"]

	for _, line := range []string{"hello", "/impeccable polish", "/exit"} {
		view.draft = line
		a.send("a", view)
	}

	if !reflect.DeepEqual(f.sent["a"], []string{"hello"}) {
		t.Errorf("sent %q", f.sent["a"])
	}
	// The service knows the skills: it sends them on to the model
	if !reflect.DeepEqual(f.commands["a"], []string{"/impeccable polish"}) {
		t.Errorf("ran %q", f.commands["a"])
	}
	if quit != 1 {
		t.Errorf("quit %d times on /exit", quit)
	}
}

func TestNoticesAndHelpShowInTheConversation(t *testing.T) {
	a, f := testApp()
	f.events["a"] = append(f.events["a"],
		Event{Type: "notice", Level: "success", Text: "Thinking: off"},
		Event{Type: "notice", Level: "warn", Text: "No such command: /nope. /help lists them."},
		Event{Type: "help", Sections: []HelpSection{{Title: "Commands", Rows: [][2]string{{"/think", "<off|high>  sets thinking"}}}, {Title: "Mode", Text: "ask: before every command"}}},
	)
	a.views = map[string]*sessionView{}
	a.Select("a")
	tt := ui.NewTester(a.View, 1100, 900)

	for _, text := range []string{"Thinking: off", "No such command: /nope. /help lists them.", "<off|high>  sets thinking", "ask: before every command", "switches ask/auto"} {
		if !tt.HasText(text) {
			t.Errorf("no %q in %q", text, tt.Texts())
		}
	}
}

func TestLoginAsksForAKeyAndCanBeDismissed(t *testing.T) {
	a, f := testApp()
	f.events["a"] = append(f.events["a"], Event{Type: "ask", ID: "2", Questions: []Question{{
		Title: "Enter your DeepSeek API key", Other: true, Secret: true, Placeholder: "sk-…",
	}}})
	a.views = map[string]*sessionView{}
	a.Select("a")
	tt := ui.NewTester(a.View, 1100, 760)

	if err := tt.Click("Your answer"); err != nil {
		t.Fatal(err)
	}
	tt.Type("sk-typed")
	if err := tt.Click("Send answer"); err != nil {
		t.Fatal(err)
	}

	if got := f.answers["a/2"]; !reflect.DeepEqual(got, [][]string{{"sk-typed"}}) {
		t.Errorf("answered %v", got)
	}
	if !tt.HasText("Dismiss") || !tt.HasText("Waiting for your answer") {
		t.Errorf("texts %q", tt.Texts())
	}
	if tt.HasText("sk-typed") {
		t.Error("the key shows as typed")
	}
}

func TestStatusAndUsageLinesAsTheTerminal(t *testing.T) {
	a, f := testApp()
	f.events["a"] = append(f.events["a"],
		Event{Type: "state", State: &State{ID: "a", Mode: "auto", Allowed: "allows commands", Replying: true, Queued: 2, Commands: testCommands,
			Usage: UsageReading{Context: &ContextSize{Tokens: 150_000, Limit: 200_000}, Cost: 0.0123, Input: 48213, Output: 3104, Cache: 86, Speed: 41, Calls: 4}}},
		Event{Type: "user", Text: "run the tests"},
		Event{Type: "tool_start", ID: "1", Name: "bash", Args: "{}"},
	)
	a.views = map[string]*sessionView{}
	a.Select("a")
	tt := ui.NewTester(a.View, 1100, 760)

	for _, text := range []string{"Running bash", "auto", "allows commands", "2 queued", "steers", "ctx 150k/200k", "$0.0123 · in 48.2k · out 3.1k · cache 86% · 41 tok/s"} {
		if !tt.HasText(text) {
			t.Errorf("no %q in %q", text, tt.Texts())
		}
	}
}

func TestHelpReadsRowsAndLines(t *testing.T) {
	var e Event
	raw := `{"seq":4,"type":"help","sections":[{"title":"Commands","rows":[["/think","<off|high>  sets thinking"]]},{"title":"Mode","rows":"ask: before every command"}]}`
	if err := json.Unmarshal([]byte(raw), &e); err != nil {
		t.Fatal(err)
	}

	want := []HelpSection{{Title: "Commands", Rows: [][2]string{{"/think", "<off|high>  sets thinking"}}}, {Title: "Mode", Text: "ask: before every command"}}
	if !reflect.DeepEqual(e.Sections, want) {
		t.Errorf("sections %+v", e.Sections)
	}
}
