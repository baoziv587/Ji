package conversation

// The conversation as the window shows it, built from the service's events
// one at a time: no drawing here, so it is tested as plain data.

import (
	"sort"
	"strings"
	"time"

	"github.com/egoist/mygo/ui"

	"desktop/agent"
	"desktop/format"
	"desktop/syntax"
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
	// Where the history became a summary, and while it does.
	KindCompaction
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
	// The history's size before a compaction and after, 0 while it runs.
	Before, After int
	// Where it is among the blocks, and among the steps when it is one: the
	// thinking or a call.
	Block, Step int
	// The reply's text or the thinking in Markdown's blocks, parsed as it
	// comes (markdown.go).
	md markdown
	// The text written so far, which Text reads without a copy: adding each
	// delta to a string would copy the whole of it again.
	written *strings.Builder
}

// ToolCall is a call the agent made, and how it ended once it has.
type ToolCall struct {
	ID, Name, Args, Output string
	// Args on one line, cut short: the call's title shows only its start,
	// and a write's are the whole file.
	Summary  string
	Done, OK bool
	MS       int
	// Stopped is a call the reply ended before it did.
	Stopped bool
	// What the call worked on: the file, the command or the pattern; and
	// the line a read starts at.
	Target string
	Offset int
	// An edit's lines added and removed, and its diff, read from its
	// arguments as it starts.
	Edit           bool
	Added, Removed int
	Diff           []DiffLine
	// What the inspector shows of it, and whether it had ended then.
	lines     []inspectLine
	linesDone bool
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

// DiffLine is a line of a command or a diff, and what it is; and, once
// colored, the block its code is colored in, which line of it it is there,
// and the part of it a change made, in bytes of its code.
type DiffLine struct {
	Text    string
	Kind    DiffKind
	Code    *syntax.Block
	At      int
	Changed [2]int
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
	Items []*Item
	// What the conversation shows in order, and the thinking and calls
	// among the items, which the inspector steps through.
	Blocks []Block
	Steps  []*Item
	// The step the inspector shows, nil for none; the window's own.
	Inspected *Item
	Asking    *Asking
	State     agent.State
	// What a reply that did not finish was sent, for the input to take back.
	Unsent string
	// What the reply in progress is doing, as the terminal's status line
	// says it, and since when.
	Activity string
	Since    time.Time
	// The calls running, by id, for the activity.
	running map[string]string
	// The call whose lines the inspector keeps.
	linesOf *ToolCall
	// The row of the list each block starts at, as far as counted, and
	// where the list showed in the last frame; the window's own.
	starts []int
	sight  ui.Rect
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
		if w := t.work(); w != nil {
			w.Glimpse = glimpse(t.Items[len(t.Items)-1].md.tail(glimpsed))
		}
		t.doing("Thinking")
	case "tool_start":
		call := &ToolCall{ID: e.ID, Name: e.Name, Args: e.Args, Summary: format.OneLine(format.Head(e.Args, 512))}
		describe(call)
		t.add(&Item{Kind: KindTool, Tool: call})
		if t.running == nil {
			t.running = map[string]string{}
		}
		t.running[e.ID] = e.Name
		t.doing(t.runningLabel())
	case "tool_end":
		delete(t.running, e.ID)
		t.doing(t.runningLabel())
		item := t.tool(e.ID)
		if item == nil {
			item = &Item{Kind: KindTool, Tool: &ToolCall{ID: e.ID, Name: e.Name}}
			t.add(item)
		}
		call := item.Tool
		call.Done, call.OK, call.Output, call.MS = true, e.OK, e.Output, e.MS
		t.ended(item)
	case "ask":
		details := make([][]DiffLine, len(e.Questions))
		lang := t.askedIn(e.Tool)
		for i, q := range e.Questions {
			if q.Detail != "" {
				details[i] = diffLines(q.Detail)
				colorDiff(details[i], lang)
			}
		}
		t.Asking = &Asking{ID: e.ID, Tool: e.Tool, Outside: e.Outside, Questions: e.Questions, Details: details}
		t.doing("Waiting for your answer")
	case "ask_closed":
		if t.Asking != nil && t.Asking.ID == e.ID {
			t.Asking = nil
		}
		t.doing(t.runningLabel())
	case "compacting":
		t.add(&Item{Kind: KindCompaction, Before: e.Tokens})
		t.doing("Compacting " + format.Count(e.Tokens) + " tokens")
	case "compacted":
		t.compacted(e)
		t.doing("Waiting")
	case "notice":
		t.add(&Item{Kind: KindNotice, Level: e.Level, Failed: e.Level == "error", Text: e.Text})
	case "help":
		t.add(&Item{Kind: KindHelp, Help: e.Sections})
	case "reply_end":
		t.settle()
		t.doing("")
		if item := t.compacting(); item != nil {
			item.keptInFull("Stopped compacting.")
		}
		// What still runs, the reply ended before
		for id := range t.running {
			if item := t.tool(id); item != nil {
				item.Tool.Done, item.Tool.Stopped = true, true
				t.ended(item)
			}
		}
		clear(t.running)
		t.rest()
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

// compacted ends the compaction that runs: its seam then says what the
// history became. One kept as it was turns into a notice that says why, a
// warning when a summary was tried, and a note when there was nothing to
// summarize.
func (t *Transcript) compacted(e agent.Event) {
	item := t.compacting()
	switch {
	case e.Error == "" && item != nil:
		item.Before, item.After = e.Before, e.After
	case e.Error == "":
		t.add(&Item{Kind: KindCompaction, Before: e.Before, After: e.After})
	case item != nil:
		item.keptInFull("Couldn't compact: " + e.Error + ".")
	default:
		t.add(&Item{Kind: KindNotice, Level: "info", Text: "Not compacted: " + e.Error + "."})
	}
}

// compacting is the compaction that runs, if one does.
func (t *Transcript) compacting() *Item {
	for i := len(t.Items) - 1; i >= 0; i-- {
		if it := t.Items[i]; it.Kind == KindCompaction {
			if it.After == 0 {
				return it
			}
			return nil
		}
	}
	return nil
}

// keptInFull turns a compaction that ran into a warning that it did not
// end in a summary, and why.
func (it *Item) keptInFull(why string) {
	it.Kind, it.Level, it.Text = KindNotice, "warn", why+" The conversation goes on in full."
}

// add puts an item at the end: a step joins the work at the end, or starts
// one; anything else ends that work and is a block of its own.
func (t *Transcript) add(item *Item) {
	t.settle()
	t.Items = append(t.Items, item)
	if item.Kind != KindThinking && item.Kind != KindTool {
		t.rest()
		item.Block = len(t.Blocks)
		t.Blocks = append(t.Blocks, Block{Item: item})
		return
	}

	w := t.work()
	if w == nil {
		w = &Work{}
		t.Blocks = append(t.Blocks, Block{Work: w})
	}
	item.Block, item.Step = len(t.Blocks)-1, len(t.Steps)
	t.Steps = append(t.Steps, item)
	w.Steps = append(w.Steps, item)
	// Thinking ends as a call starts
	thinking := w.Current != nil && w.Current.Kind == KindThinking
	w.Current, w.Glimpse = item, ""
	if thinking {
		w.tally(t.State.Root)
	}
}

// work is the work at the end of the conversation, nil when it ends with
// something else.
func (t *Transcript) work() *Work {
	if n := len(t.Blocks); n > 0 {
		return t.Blocks[n-1].Work
	}
	return nil
}

// ended takes in a call that ended: the step in progress is then another
// still running, or none.
func (t *Transcript) ended(item *Item) {
	w := t.Blocks[item.Block].Work
	if w.Current == item {
		w.Current = nil
		for i := len(w.Steps) - 1; i >= 0; i-- {
			if call := w.Steps[i].Tool; call != nil && !call.Done {
				w.Current = w.Steps[i]
				break
			}
		}
	}
	w.tally(t.State.Root)
}

// rest ends the thinking of the work at the end, as what follows it comes.
func (t *Transcript) rest() {
	w := t.work()
	if w == nil || w.Current == nil || w.Current.Kind != KindThinking {
		return
	}
	w.Current, w.Glimpse = nil, ""
	w.tally(t.State.Root)
}

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
	item := &Item{Kind: kind}
	if n := len(t.Items); n > 0 && t.Items[n-1].Kind == kind {
		item = t.Items[n-1]
	} else {
		t.add(item)
	}
	if item.written == nil {
		item.written = &strings.Builder{}
	}
	item.written.WriteString(delta)
	item.Text = item.written.String()
	item.md.update(item.Text, false)
}

// settle shows the text or the thinking at the end whole, the line held
// back as it was written too, as no more of it comes.
func (t *Transcript) settle() {
	if n := len(t.Items); n > 0 {
		if it := t.Items[n-1]; it.Kind == KindText || it.Kind == KindThinking {
			it.md.update(it.Text, true)
		}
	}
}

// askedIn is the language of what a call asked about shows in: a command
// as shell, a diff as the file it changes.
func (t *Transcript) askedIn(tool string) *syntax.Lang {
	if tool == "bash" {
		return syntax.Language("bash")
	}
	for i := len(t.Steps) - 1; i >= 0; i-- {
		if call := t.Steps[i].Tool; call != nil && call.Name == tool && !call.Done {
			return syntax.Language(call.Target)
		}
	}
	return nil
}

func (t *Transcript) tool(id string) *Item {
	for i := len(t.Items) - 1; i >= 0; i-- {
		if call := t.Items[i].Tool; call != nil && call.ID == id {
			return t.Items[i]
		}
	}
	return nil
}

// rows is how many rows of the list the blocks take: a reply a row for
// each of its blocks, so that a long one is built only as far as it
// shows. Only the block at the end grows, so the others are counted once.
func (t *Transcript) rows() int {
	n := len(t.Blocks)
	if n == 0 {
		return 0
	}
	if len(t.starts) == 0 {
		t.starts = append(t.starts, 0)
	}
	for k := len(t.starts); k < n; k++ {
		t.starts = append(t.starts, t.starts[k-1]+t.Blocks[k-1].rows())
	}
	return t.starts[n-1] + t.Blocks[n-1].rows()
}

// RowOf is the row of the list block starts at.
func (t *Transcript) RowOf(block int) int {
	t.rows()
	return t.starts[block]
}

// row is the block row i of the list is of, and which of its rows; after
// rows counted them.
func (t *Transcript) row(i int) (block, part int) {
	block = sort.Search(len(t.starts), func(k int) bool { return t.starts[k] > i }) - 1
	return block, i - t.starts[block]
}

func (b Block) rows() int {
	if b.Item != nil && b.Item.Kind == KindText {
		return len(b.Item.md.blocks)
	}
	return 1
}
