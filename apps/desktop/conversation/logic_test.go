package conversation

import (
	"reflect"
	"strings"
	"testing"

	"desktop/agent"
)

func TestTranscriptJoinsDeltasAndEndsCalls(t *testing.T) {
	var tr Transcript
	var activities []string
	for _, e := range []agent.Event{
		{Type: "user", Text: "list files"},
		{Type: "thinking", Delta: "Let me "},
		{Type: "thinking", Delta: "look."},
		{Type: "tool_start", ID: "1", Name: "bash", Args: `{"command":"ls"}`},
		{Type: "tool_end", ID: "1", Name: "bash", OK: true, Output: "a.go", MS: 12},
		{Type: "text", Delta: "There is "},
		{Type: "text", Delta: "a.go."},
		{Type: "reply_end", Outcome: "done", Usage: &agent.Usage{Input: 100, Output: 20, Cost: 0.01}},
	} {
		tr.Apply(e)
		activities = append(activities, tr.Activity)
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
	// What the status line says, after each event, as the terminal's
	want := []string{"Waiting", "Thinking", "Thinking", "Running bash", "Waiting", "Writing", "Writing", ""}
	if !reflect.DeepEqual(activities, want) {
		t.Errorf("activities %q, want %q", activities, want)
	}
}

func TestTranscriptGivesBackWhatAFailedReplyWasSent(t *testing.T) {
	var tr Transcript
	tr.Apply(agent.Event{Type: "ask", ID: "3", Questions: []agent.Question{{Title: "Run ls"}}})
	tr.Apply(agent.Event{Type: "ask_closed", ID: "3"})
	unfinished := tr.Apply(agent.Event{Type: "reply_end", Outcome: "failed", Error: "rate limited", Unsent: "list files"})

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

func TestAskingCutsDetailsIntoLines(t *testing.T) {
	var tr Transcript
	tr.Apply(agent.Event{Type: "ask", ID: "1", Questions: []agent.Question{
		{Title: "Edit a.go", Detail: "--- a.go\n+++ a.go\n@@ -1 +1 @@\n-old\n+new\n same"},
		{Title: "Pick one"},
	}})
	want := []DiffLine{
		{Text: "--- a.go", Kind: DiffMeta}, {Text: "+++ a.go", Kind: DiffMeta}, {Text: "@@ -1 +1 @@", Kind: DiffMeta},
		{Text: "-old", Kind: DiffRemoved}, {Text: "+new", Kind: DiffAdded}, {Text: " same", Kind: DiffPlain},
	}
	details := tr.Asking.Details
	if len(details) != 2 || details[1] != nil {
		t.Fatalf("details %+v", details)
	}
	var got []DiffLine
	for _, line := range details[0] {
		got = append(got, DiffLine{Text: line.Text, Kind: line.Kind})
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("details %+v", got)
	}
}

func TestCompactionRunsThenSaysWhatTheHistoryBecame(t *testing.T) {
	var tr Transcript
	tr.Apply(agent.Event{Type: "user", Text: "go on"})
	tr.Apply(agent.Event{Type: "compacting", Tokens: 180_000})
	seam := tr.Items[len(tr.Items)-1]
	if seam.Kind != KindCompaction || seam.After != 0 || tr.Activity != "Compacting 180k tokens" {
		t.Fatalf("running: %+v, activity %q", seam, tr.Activity)
	}

	tr.Apply(agent.Event{Type: "compacted", Before: 180_000, After: 32_000})
	if seam.Before != 180_000 || seam.After != 32_000 || len(tr.Items) != 2 {
		t.Errorf("done: %+v, %d items", seam, len(tr.Items))
	}
}

func TestCompactionKeptAsItWasSaysWhy(t *testing.T) {
	var tr Transcript
	tr.Apply(agent.Event{Type: "compacting", Tokens: 180_000})
	tr.Apply(agent.Event{Type: "compacted", Before: 180_000, After: 180_000, Error: "timed out"})
	// Asked for with nothing new: no summary was tried
	tr.Apply(agent.Event{Type: "compacted", Before: 40_000, After: 40_000, Error: "nothing new since the last summary"})
	tr.Apply(agent.Event{Type: "compacting", Tokens: 50_000})
	tr.Apply(agent.Event{Type: "reply_end", Outcome: "done"})

	var got [][2]string
	for _, it := range tr.Items {
		got = append(got, [2]string{it.Level, it.Text})
	}
	want := [][2]string{
		{"warn", "Couldn't compact: timed out. The conversation goes on in full."},
		{"info", "Not compacted: nothing new since the last summary."},
		{"warn", "Stopped compacting. The conversation goes on in full."},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("notices %q, want %q", got, want)
	}
	for _, it := range tr.Items {
		if it.Kind != KindNotice {
			t.Errorf("a %v left after the compaction kept the history", it.Kind)
		}
	}
}
