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
