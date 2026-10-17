package conversation

import (
	"fmt"
	"strings"
	"testing"

	"github.com/egoist/mygo/ui"

	"desktop/agent"
)

func viewTester(tr *Transcript) *ui.Tester {
	var list ui.ListState
	tr.Apply(agent.Event{Type: "state", State: &agent.State{ID: "s"}})
	return ui.NewTester(func(c *ui.Context) { View(c, &list, tr) }, 900, 600)
}

func built(tt *ui.Tester, prefix string) int {
	n := 0
	for _, text := range tt.Texts() {
		if strings.HasPrefix(text, prefix) {
			n++
		}
	}
	return n
}

// A long reply is a row of the list for each of its blocks: only those in
// view are built, and its end is in view as it is written.
func TestALongReplyBuildsWhatIsInView(t *testing.T) {
	var tr Transcript
	tt := viewTester(&tr)
	tr.Apply(agent.Event{Type: "user", Text: "go on"})
	for i := range 300 {
		tr.Apply(agent.Event{Type: "text", Delta: fmt.Sprintf("paragraph %d\n\n", i)})
	}
	tr.Apply(agent.Event{Type: "reply_end", Outcome: "done"})
	tt.Frame()

	if n := built(tt, "paragraph "); n == 0 || n > 60 {
		t.Errorf("%d of 300 paragraphs built", n)
	}
	if !tt.HasText("paragraph 299") || tt.HasText("go on") {
		t.Errorf("not at the end: %v", tt.Texts())
	}
	if got, want := tr.rows(), 301; got != want {
		t.Errorf("%d rows, want %d", got, want)
	}
	if k, part := tr.row(300); k != 1 || part != 299 || tr.RowOf(1) != 1 {
		t.Errorf("row 300 is block %d's %d", k, part)
	}
}

// A work open on many steps builds only the steps around what shows, and
// as it scrolls, those it scrolls to.
func TestAnOpenWorkBuildsTheStepsInSight(t *testing.T) {
	var tr Transcript
	tt := viewTester(&tr)
	tr.Apply(agent.Event{Type: "user", Text: "go on"})
	for i := range 400 {
		id := fmt.Sprint("c", i)
		tr.Apply(
			agent.Event{
				Type: "tool_start",
				ID:   id,
				Name: "bash",
				Args: fmt.Sprintf(`{"command":"step %d"}`, i),
			},
		)
		tr.Apply(agent.Event{Type: "tool_end", ID: id, Name: "bash", OK: true})
	}
	tr.Apply(agent.Event{Type: "reply_end", Outcome: "done"})
	tr.Blocks[1].Work.Open = true
	for range 3 {
		tt.Frame()
	}

	if n := built(tt, "step "); n == 0 || n > 120 {
		t.Fatalf("%d of 400 steps built", n)
	}
	if !tt.HasText("step 399") {
		t.Errorf("the last step not built: %v", tt.Texts())
	}
	for range 40 {
		tt.Scroll(450, 300, 0, -500)
	}
	if !tt.HasText("step 0") || built(tt, "step ") > 120 {
		t.Errorf(
			"at the top, %d steps built, the first among them: %v",
			built(tt, "step "),
			tt.HasText("step 0"),
		)
	}
	r, _ := tt.Find("step 0")
	if r.Y < 0 || r.Y > 600 {
		t.Errorf("the first step at %v, out of sight", r)
	}
}

// A delta of a reply long past the screen costs a frame what one of a
// short reply does.
func BenchmarkStreamingALongReply(b *testing.B) {
	var tr Transcript
	tt := viewTester(&tr)
	tr.Apply(agent.Event{Type: "user", Text: "go on"})
	for i := range 400 {
		tr.Apply(
			agent.Event{
				Type: "text",
				Delta: fmt.Sprintf(
					"Paragraph %d says a thing or two about **this** and `that`, as a reply does.\n\n",
					i,
				),
			},
		)
	}
	tt.Frame()
	b.ReportAllocs()
	b.ResetTimer()
	for i := range b.N {
		tr.Apply(agent.Event{Type: "text", Delta: fmt.Sprint("word", i, " ")})
		tt.Frame()
	}
}
