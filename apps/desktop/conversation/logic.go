package conversation

// The conversation as the window shows it, built from the service's events
// one at a time: no drawing here, so it is tested as plain data.

import (
	"fmt"
	"strings"
	"time"

	"desktop/agent"
	"desktop/format"
)

type ItemKind int

const (
	KindUser ItemKind = iota
	KindText
	KindThinking
	KindTool
	KindNotice
	// What /help lists.
	KindHelp
)

// Item is one block of the conversation.
type Item struct {
	Kind ItemKind
	// The message, the reply's text, the thinking or the notice.
	Text  string
	Steer bool
	// A notice that something went wrong.
	Failed bool
	// A command's notice: info, success, warn or error.
	Level string
	Help  []agent.HelpSection
	Tool  *ToolCall
	// Whether the thinking or the tool's output is shown; the window's own.
	Open bool
}

// ToolCall is a call the agent made, and how it ended once it has.
type ToolCall struct {
	ID, Name, Args, Output string
	// Args on one line, cut short: the call's title shows only its start,
	// and a write's are the whole file.
	Summary  string
	Done, OK bool
	MS       int
}

// Asking is the questions waiting for the person's answer.
type Asking struct {
	ID        string
	Tool      string
	Outside   bool
	Questions []agent.Question
	// Each question's Detail cut into its lines once, as it comes: a
	// write's is the whole file, too long to cut every frame.
	Details [][]DiffLine
}

type DiffKind int

const (
	DiffPlain DiffKind = iota
	// A file's name or a hunk's head.
	DiffMeta
	DiffAdded
	DiffRemoved
)

// DiffLine is a line of a command or a diff, and what it is.
type DiffLine struct {
	Text string
	Kind DiffKind
}

// diffLines cuts text into its lines, telling added from removed.
func diffLines(text string) []DiffLine {
	lines := strings.Split(text, "\n")
	out := make([]DiffLine, len(lines))
	for i, line := range lines {
		out[i].Text = line
		switch {
		case strings.HasPrefix(line, "+++"), strings.HasPrefix(line, "---"), strings.HasPrefix(line, "@@"):
			out[i].Kind = DiffMeta
		case strings.HasPrefix(line, "+"):
			out[i].Kind = DiffAdded
		case strings.HasPrefix(line, "-"):
			out[i].Kind = DiffRemoved
		}
	}
	return out
}

// Transcript is everything the service said since the last reset.
type Transcript struct {
	Items  []*Item
	Asking *Asking
	State  agent.State
	// What a reply that did not finish was sent, for the input to take back.
	Unsent string
	// What the reply in progress is doing, as the terminal's status line
	// says it, and since when.
	Activity string
	Since    time.Time
	// The calls running, by id, for the activity.
	running map[string]string
}

// Apply takes in one event; it reports whether a reply ended unfinished, its
// messages then in Unsent.
func (t *Transcript) Apply(e agent.Event) (unfinished bool) {
	switch e.Type {
	case "user":
		t.add(&Item{Kind: KindUser, Text: e.Text, Steer: e.Steer})
		t.doing("Waiting")
	case "text":
		t.extend(KindText, e.Delta)
		t.doing("Writing")
	case "thinking":
		t.extend(KindThinking, e.Delta)
		t.doing("Thinking")
	case "tool_start":
		call := &ToolCall{ID: e.ID, Name: e.Name, Args: e.Args, Summary: format.OneLine(format.Head(e.Args, 512))}
		t.add(&Item{Kind: KindTool, Tool: call})
		if t.running == nil {
			t.running = map[string]string{}
		}
		t.running[e.ID] = e.Name
		t.doing(t.runningLabel())
	case "tool_end":
		delete(t.running, e.ID)
		t.doing(t.runningLabel())
		call := t.tool(e.ID)
		if call == nil {
			call = &ToolCall{ID: e.ID, Name: e.Name}
			t.add(&Item{Kind: KindTool, Tool: call})
		}
		call.Done, call.OK, call.Output, call.MS = true, e.OK, e.Output, e.MS
	case "ask":
		details := make([][]DiffLine, len(e.Questions))
		for i, q := range e.Questions {
			if q.Detail != "" {
				details[i] = diffLines(q.Detail)
			}
		}
		t.Asking = &Asking{ID: e.ID, Tool: e.Tool, Outside: e.Outside, Questions: e.Questions, Details: details}
		t.doing("Waiting for your answer")
	case "ask_closed":
		if t.Asking != nil && t.Asking.ID == e.ID {
			t.Asking = nil
		}
		t.doing(t.runningLabel())
	case "compacted":
		t.add(&Item{Kind: KindNotice, Text: fmt.Sprintf("Compacted the history: %s → %s tokens", format.Count(e.Before), format.Count(e.After))})
		t.doing("Waiting")
	case "notice":
		t.add(&Item{Kind: KindNotice, Level: e.Level, Failed: e.Level == "error", Text: e.Text})
	case "help":
		t.add(&Item{Kind: KindHelp, Help: e.Sections})
	case "reply_end":
		t.doing("")
		clear(t.running)
		switch e.Outcome {
		case "stopped":
			t.add(&Item{Kind: KindNotice, Text: "Stopped. Your message is back in the input."})
		case "failed":
			t.add(&Item{Kind: KindNotice, Failed: true, Text: e.Error + "\nYour message is back in the input."})
		}
		if e.Outcome != "done" {
			t.Unsent = e.Unsent
			return true
		}
	case "state":
		if e.State != nil {
			t.State = *e.State
		}
	}
	return false
}

func (t *Transcript) add(item *Item) { t.Items = append(t.Items, item) }

// doing says what the reply does now; a new label starts its own count.
func (t *Transcript) doing(label string) {
	if label != t.Activity {
		t.Activity, t.Since = label, time.Now()
	}
}

// runningLabel is the calls running by name, as the terminal says it, or
// Waiting with none.
func (t *Transcript) runningLabel() string {
	if len(t.running) == 0 {
		return "Waiting"
	}
	var names []string
	seen := map[string]bool{}
	for _, item := range t.Items {
		if call := item.Tool; call != nil && t.running[call.ID] != "" && !seen[call.Name] {
			seen[call.Name] = true
			names = append(names, call.Name)
		}
	}
	return "Running " + strings.Join(names, ", ")
}

// extend adds to the text or the thinking being written, or starts one.
func (t *Transcript) extend(kind ItemKind, delta string) {
	if n := len(t.Items); n > 0 && t.Items[n-1].Kind == kind {
		t.Items[n-1].Text += delta
		return
	}
	t.add(&Item{Kind: kind, Text: delta})
}

func (t *Transcript) tool(id string) *ToolCall {
	for i := len(t.Items) - 1; i >= 0; i-- {
		if call := t.Items[i].Tool; call != nil && call.ID == id {
			return call
		}
	}
	return nil
}
