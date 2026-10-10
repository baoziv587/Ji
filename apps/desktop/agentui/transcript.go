package agentui

// The conversation as the window shows it, built from the service's events
// one at a time: no drawing here, so it is tested as plain data.

import "fmt"

type ItemKind int

const (
	KindUser ItemKind = iota
	KindText
	KindThinking
	KindTool
	KindNotice
)

// Item is one block of the conversation.
type Item struct {
	Kind ItemKind
	// The message, the reply's text, the thinking or the notice.
	Text  string
	Steer bool
	// A notice that something went wrong.
	Failed bool
	Tool   *ToolCall
	// Whether the thinking or the tool's output is shown; the window's own.
	Open bool
}

// ToolCall is a call the agent made, and how it ended once it has.
type ToolCall struct {
	ID, Name, Args, Output string
	Done, OK               bool
	MS                     int
}

// Asking is the questions waiting for the person's answer.
type Asking struct {
	ID        string
	Tool      string
	Outside   bool
	Questions []Question
}

// Transcript is everything the service said since the last reset.
type Transcript struct {
	Items  []*Item
	Asking *Asking
	State  State
	// What the replies spent, summed.
	Usage Usage
	// What a reply that did not finish was sent, for the input to take back.
	Unsent string
}

// Apply takes in one event; it reports whether a reply ended unfinished, its
// messages then in Unsent.
func (t *Transcript) Apply(e Event) (unfinished bool) {
	switch e.Type {
	case "user":
		t.add(&Item{Kind: KindUser, Text: e.Text, Steer: e.Steer})
	case "text":
		t.extend(KindText, e.Delta)
	case "thinking":
		t.extend(KindThinking, e.Delta)
	case "tool_start":
		t.add(&Item{Kind: KindTool, Tool: &ToolCall{ID: e.ID, Name: e.Name, Args: e.Args}})
	case "tool_end":
		call := t.tool(e.ID)
		if call == nil {
			call = &ToolCall{ID: e.ID, Name: e.Name}
			t.add(&Item{Kind: KindTool, Tool: call})
		}
		call.Done, call.OK, call.Output, call.MS = true, e.OK, e.Output, e.MS
	case "ask":
		t.Asking = &Asking{ID: e.ID, Tool: e.Tool, Outside: e.Outside, Questions: e.Questions}
	case "ask_closed":
		if t.Asking != nil && t.Asking.ID == e.ID {
			t.Asking = nil
		}
	case "compacted":
		t.add(&Item{Kind: KindNotice, Text: fmt.Sprintf("Compacted the history: %s → %s tokens", count(e.Before), count(e.After))})
	case "reply_end":
		if e.Usage != nil {
			t.Usage.Input += e.Usage.Input
			t.Usage.Output += e.Usage.Output
			t.Usage.Cost += e.Usage.Cost
		}
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

func count(n int) string {
	if n >= 1000 {
		return fmt.Sprintf("%.1fk", float64(n)/1000)
	}
	return fmt.Sprint(n)
}
