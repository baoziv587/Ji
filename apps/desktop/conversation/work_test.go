package conversation

import (
	"reflect"
	"strings"
	"testing"

	"desktop/agent"
)

func TestWorkFoldsTheStepsBetweenTheText(t *testing.T) {
	var tr Transcript
	tr.Apply(agent.Event{Type: "state", State: &agent.State{ID: "a", Root: "/code/web"}})
	steps := []agent.Event{
		{Type: "user", Text: "fix the form"},
		{Type: "thinking", Delta: "Probably a double binding.\nLet me look"},
		{Type: "tool_start", ID: "1", Name: "grep", Args: `{"pattern":"onSubmit"}`},
		{Type: "tool_end", ID: "1", OK: true, Output: "src/Login.tsx:14", MS: 40},
		{Type: "tool_start", ID: "2", Name: "read", Args: `{"path":"/code/web/src/Login.tsx"}`},
		{Type: "tool_end", ID: "2", OK: true, Output: "…", MS: 10},
		{Type: "tool_start", ID: "3", Name: "read", Args: `{"path":"/code/web/src/Form.tsx"}`},
		{Type: "tool_end", ID: "3", OK: true, Output: "…", MS: 10},
		{Type: "tool_start", ID: "4", Name: "bash", Args: `{"command":"pnpm  test"}`},
		{Type: "tool_end", ID: "4", OK: false, Output: "1 failed\nat Login.test.tsx", MS: 900},
		{Type: "tool_start", ID: "5", Name: "edit", Args: `{"path":"/code/web/src/Login.tsx","edits":[{"old_text":"a\nb\n","new_text":"c\n"}]}`},
		{Type: "tool_end", ID: "5", OK: true, Output: "ok", MS: 5},
		{Type: "text", Delta: "Fixed."},
	}
	for _, e := range steps {
		tr.Apply(e)
	}

	if len(tr.Blocks) != 3 || tr.Blocks[1].Work == nil || tr.Blocks[2].Item.Kind != KindText {
		t.Fatalf("blocks %+v", tr.Blocks)
	}
	w := tr.Blocks[1].Work
	if want := "Thought, searched for \"onSubmit\", read 2 files, edited Login.tsx"; w.Summary != want {
		t.Errorf("summary %q, want %q", w.Summary, want)
	}
	if w.MS != 965 || w.Current != nil || w.Outcome() != "done" || w.Done() != 6 {
		t.Errorf("ms %d, current %v, outcome %q, done %d", w.MS, w.Current, w.Outcome(), w.Done())
	}
	if len(w.Files) != 1 || *w.Files[0] != (FileChange{Path: "src/Login.tsx", Added: 1, Removed: 2, Last: tr.Steps[5]}) {
		t.Errorf("files %+v", w.Files)
	}
	if len(w.Failed) != 1 || w.Failed[0].Tool.Name != "bash" {
		t.Errorf("failed %+v", w.Failed)
	}
	// The inspector goes through the steps in order
	if len(tr.Steps) != 6 || tr.Steps[4].Step != 4 || tr.Steps[4].Block != 1 {
		t.Errorf("steps %d, the fifth %+v", len(tr.Steps), tr.Steps[4])
	}
	diff := []DiffKind{DiffMeta, DiffMeta, DiffMeta, DiffRemoved, DiffRemoved, DiffAdded}
	var got []DiffKind
	for _, line := range tr.Steps[5].Tool.Diff {
		got = append(got, line.Kind)
	}
	if !reflect.DeepEqual(got, diff) {
		t.Errorf("diff %+v", tr.Steps[5].Tool.Diff)
	}
}

// The glimpse reads only the end of a long paragraph of thinking, and says
// what reading all of it says, a delta at a time.
func TestTheGlimpseReadsOnlyTheEnd(t *testing.T) {
	var tr Transcript
	text := strings.Repeat("A **long** thought, with `code` and *more* in it. ", 40) + "é, at last"
	for i := 0; i < len(text); i += 7 {
		tr.Apply(agent.Event{Type: "thinking", Delta: text[i:min(i+7, len(text))]})

		md := &tr.Items[len(tr.Items)-1].md
		var whole strings.Builder
		for _, r := range md.blocks[len(md.blocks)-1].runs {
			whole.WriteString(r.text)
		}
		if got, want := tr.work().Glimpse, glimpse(whole.String()); got != want {
			t.Fatalf("after %d bytes, glimpse %q, want %q", i, got, want)
		}
	}
}

func TestWorkSaysWhatItDoesNow(t *testing.T) {
	var tr Transcript
	tr.Apply(agent.Event{Type: "thinking", Delta: "First, the tests.\nThen the "})
	w := tr.work()
	if w.Current == nil || w.Current.Kind != KindThinking || w.Glimpse != "Then the" || w.Outcome() != "running" || w.Done() != 0 {
		t.Fatalf("current %+v, glimpse %q, done %d", w.Current, w.Glimpse, w.Done())
	}

	tr.Apply(agent.Event{Type: "tool_start", ID: "1", Name: "bash", Args: `{"command":"pnpm test"}`})
	if w.Current.Tool == nil || w.Current.Tool.Target != "pnpm test" || w.Summary != "Thought" || w.Done() != 1 {
		t.Fatalf("current %+v, summary %q", w.Current, w.Summary)
	}

	// The reply ends before the call does: it stopped, and the work rests
	tr.Apply(agent.Event{Type: "reply_end", Outcome: "stopped"})
	if w.Current != nil || len(w.Failed) != 1 || !w.Failed[0].Tool.Stopped || w.Outcome() != "done" {
		t.Errorf("current %+v, failed %+v, outcome %q", w.Current, w.Failed, w.Outcome())
	}
}

func TestWorkOfOnlyFailedCallsFailed(t *testing.T) {
	var tr Transcript
	tr.Apply(agent.Event{Type: "tool_start", ID: "1", Name: "bash", Args: `{"command":"make"}`})
	tr.Apply(agent.Event{Type: "tool_end", ID: "1", OK: false, Output: "no rule"})
	w := tr.work()
	if w.Outcome() != "failed" || w.Summary != "1 call failed" {
		t.Errorf("outcome %q, summary %q", w.Outcome(), w.Summary)
	}

	tr.Apply(agent.Event{Type: "tool_start", ID: "2", Name: "bash", Args: `{"command":"make all"}`})
	tr.Apply(agent.Event{Type: "reply_end", Outcome: "stopped"})
	if w.Outcome() != "stopped" || w.Summary != "Stopped" {
		t.Errorf("outcome %q, summary %q after a stop", w.Outcome(), w.Summary)
	}
}

func TestPhraseSaysOneByNameAndManyByCount(t *testing.T) {
	for _, c := range []struct {
		verb    string
		targets []string
		want    string
	}{
		{"read", []string{"a.go", "a.go"}, "read a.go"},
		{"read", []string{"a.go", "b.go"}, "read 2 files"},
		{"searched", []string{"x", "y", "z"}, "searched 3 times"},
		{"ran", []string{"go test ./... -run TestSomethingRatherLongToName"}, "ran go test ./... -run TestSomethingRatherL…"},
		{"ran", []string{"a", "b"}, "ran 2 commands"},
		{"used todo", []string{"", ""}, "used todo 2 times"},
	} {
		if got := phrase(c.verb, c.targets); got != c.want {
			t.Errorf("phrase(%q, %q) = %q, want %q", c.verb, c.targets, got, c.want)
		}
	}
}
