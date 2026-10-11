package conversation

import (
	"testing"

	"desktop/agent"
	"desktop/syntax"
)

func init() {
	syntax.Background = func(fn func()) { fn() }
}

// An edit's removed and added lines are colored as the file before and
// after, and a line changed marks the part that changed.
func TestDiffColorsEachRunAndMarksTheChange(t *testing.T) {
	var tr Transcript
	tr.Apply(agent.Event{Type: "tool_start", ID: "1", Name: "edit", Args: `{"path":"a.go","edits":[{"old_text":"x := 1\n/* a","new_text":"x := 2\n/* a"}]}`})
	diff := tr.Steps[0].Tool.Diff
	removed, added := diff[3], diff[5]
	if removed.Code == nil || removed.Code == added.Code || added.At != 0 || diff[6].At != 1 {
		t.Fatalf("diff %+v", diff)
	}
	if removed.Changed != [2]int{5, 6} || added.Changed != [2]int{5, 6} || diff[6].Changed != [2]int{} {
		t.Errorf("changed %v %v %v", removed.Changed, added.Changed, diff[6].Changed)
	}
	if line := added.Code.Lines()[0]; line[len(line)-1] != (syntax.Span{Text: "2", Kind: syntax.Number}) {
		t.Errorf("added %+v", line)
	}
}

func TestChangedIsWhatTwoLinesDoNotShare(t *testing.T) {
	for _, c := range []struct {
		a, b     string
		inA, inB [2]int
	}{
		{"x := 1", "x := 22", [2]int{5, 6}, [2]int{5, 7}},
		{"abc", "abc", [2]int{}, [2]int{}},
		{"abc", "xyz", [2]int{}, [2]int{}},
		{"a é b", "a è b", [2]int{2, 4}, [2]int{2, 4}},
		{"ab", "abc", [2]int{2, 2}, [2]int{2, 3}},
	} {
		if inA, inB := changed(c.a, c.b); inA != c.inA || inB != c.inB {
			t.Errorf("changed(%q, %q) = %v %v, want %v %v", c.a, c.b, inA, inB, c.inA, c.inB)
		}
	}
}
