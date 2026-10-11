package conversation

// The work of a reply between what it says: its thinking and its calls,
// folded into one line that says what they did. Kept as the events come,
// so the view only reads it.

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"unicode"
	"unicode/utf8"

	"desktop/format"
	"desktop/syntax"
)

// Block is a row of the conversation: an item on its own, or the work
// between what the reply says.
type Block struct {
	Item *Item
	Work *Work
}

// Work is a run of the reply's thinking and calls between its text: one
// line that says what they did, open to each step, and under it what
// stays in sight, the files changed and the calls that failed.
type Work struct {
	Steps []*Item
	// Whether its steps show; the window's own.
	Open bool
	// What the steps that ended did, on one line, and how long their calls
	// took.
	Summary string
	MS      int
	// Whether any step ended well: the thinking, or a call that succeeded.
	Succeeded bool
	Files     []*FileChange
	Failed    []*Item
	// The step in progress: a call running, or the thinking being
	// written, whose last words are Glimpse. Nil once the work rests.
	Current *Item
	Glimpse string
	// The steps built while it is open; the window's own.
	window stepsWindow
}

// FileChange is a file the work's calls changed: the lines they added and
// removed, and the last call that changed it.
type FileChange struct {
	Path           string
	Added, Removed int
	Last           *Item
}

// Done is how many of the steps ended.
func (w *Work) Done() int {
	n := 0
	for _, s := range w.Steps {
		if s.Kind == KindThinking && s != w.Current || s.Tool != nil && s.Tool.Done {
			n++
		}
	}
	return n
}

// Outcome is how the work went: "running" while a step is in progress,
// "stopped" or "failed" when no step ended well, as its last call did,
// "done" otherwise.
func (w *Work) Outcome() string {
	switch {
	case w.Current != nil:
		return "running"
	case w.Succeeded || len(w.Failed) == 0:
		return "done"
	case w.Failed[len(w.Failed)-1].Tool.Stopped:
		return "stopped"
	}
	return "failed"
}

// args is what of a call's arguments names what it did.
type args struct {
	Path    string `json:"path"`
	Command string `json:"command"`
	Pattern string `json:"pattern"`
	Offset  int    `json:"offset"`
	Content *string
	Edits   []struct {
		Old string `json:"old_text"`
		New string `json:"new_text"`
	} `json:"edits"`
}

// describe reads a call's arguments once, as it starts: what it worked
// on, and the lines an edit adds and removes.
func describe(call *ToolCall) {
	var a args
	if json.Unmarshal([]byte(call.Args), &a) != nil {
		return
	}
	call.Target, call.Offset = a.Path, a.Offset
	switch {
	case a.Command != "":
		call.Target = a.Command
	case a.Pattern != "":
		call.Target = a.Pattern
	}
	if call.Name != "edit" {
		return
	}

	call.Edit = true
	defer func() { colorDiff(call.Diff, syntax.Language(a.Path)) }()
	if a.Content != nil {
		call.Added = lineCount(*a.Content)
		call.Diff = append(call.Diff, DiffLine{Text: "+++ " + a.Path, Kind: DiffMeta})
		for _, line := range strings.Split(strings.TrimSuffix(*a.Content, "\n"), "\n") {
			call.Diff = append(call.Diff, DiffLine{Text: "+" + line, Kind: DiffAdded})
		}
		return
	}
	call.Diff = append(call.Diff, DiffLine{Text: "--- " + a.Path, Kind: DiffMeta}, DiffLine{Text: "+++ " + a.Path, Kind: DiffMeta})
	for _, e := range a.Edits {
		call.Removed += lineCount(e.Old)
		call.Added += lineCount(e.New)
		call.Diff = append(call.Diff, DiffLine{Text: "@@", Kind: DiffMeta})
		for _, line := range strings.Split(strings.TrimSuffix(e.Old, "\n"), "\n") {
			call.Diff = append(call.Diff, DiffLine{Text: "-" + line, Kind: DiffRemoved})
		}
		for _, line := range strings.Split(strings.TrimSuffix(e.New, "\n"), "\n") {
			call.Diff = append(call.Diff, DiffLine{Text: "+" + line, Kind: DiffAdded})
		}
	}
}

func lineCount(s string) int {
	if s == "" {
		return 0
	}
	return strings.Count(strings.TrimSuffix(s, "\n"), "\n") + 1
}

// tally says again what the work did, once a step ends: the calls that
// succeeded by what they did, the files changed and the calls that failed.
func (w *Work) tally(root string) {
	type clause struct {
		verb    string
		targets []string
	}
	var clauses []*clause
	by := map[string]*clause{}
	note := func(verb, target string) {
		cl := by[verb]
		if cl == nil {
			cl = &clause{verb: verb}
			by[verb] = cl
			clauses = append(clauses, cl)
		}
		cl.targets = append(cl.targets, target)
	}

	w.MS, w.Files, w.Failed = 0, nil, nil
	files := map[string]*FileChange{}
	for _, s := range w.Steps {
		if s.Kind == KindThinking {
			if s != w.Current {
				note("thought", "")
			}
			continue
		}
		call := s.Tool
		if !call.Done {
			continue
		}
		w.MS += call.MS
		if !call.OK {
			w.Failed = append(w.Failed, s)
			continue
		}

		target := relative(call.Target, root)
		switch call.Name {
		case "read":
			note("read", filepath.Base(target))
		case "grep":
			note("searched", target)
		case "bash":
			note("ran", target)
		case "edit":
			note("edited", filepath.Base(target))
			f := files[target]
			if f == nil {
				f = &FileChange{Path: target}
				files[target] = f
				w.Files = append(w.Files, f)
			}
			f.Added += call.Added
			f.Removed += call.Removed
			f.Last = s
		default:
			note("used "+call.Name, "")
		}
	}

	var parts []string
	for _, cl := range clauses {
		parts = append(parts, phrase(cl.verb, cl.targets))
	}
	w.Summary = capitalize(strings.Join(parts, ", "))
	w.Succeeded = len(parts) > 0
	switch {
	case w.Succeeded || len(w.Failed) == 0:
	case w.Failed[len(w.Failed)-1].Tool.Stopped:
		w.Summary = "Stopped"
	default:
		w.Summary = plural(len(w.Failed), "call") + " failed"
	}
}

// phrase says what calls of one kind did: what they did it to when one
// did, how many otherwise.
func phrase(verb string, targets []string) string {
	n := len(targets)
	distinct := map[string]bool{}
	for _, t := range targets {
		distinct[t] = true
	}
	switch verb {
	case "thought":
		return verb
	case "read", "edited":
		if len(distinct) == 1 {
			return verb + " " + targets[0]
		}
		return verb + " " + plural(len(distinct), "file")
	case "searched":
		if n == 1 {
			return fmt.Sprintf("searched for %q", clip(targets[0], 32))
		}
		return "searched " + plural(n, "time")
	case "ran":
		if n == 1 {
			return "ran " + clip(format.OneLine(targets[0]), 40)
		}
		return "ran " + plural(n, "command")
	}
	if n == 1 {
		return verb
	}
	return fmt.Sprintf("%s %d times", verb, n)
}

func plural(n int, noun string) string {
	if n == 1 {
		return "1 " + noun
	}
	return fmt.Sprintf("%d %ss", n, noun)
}

// clip cuts s to n characters at most, an ellipsis standing for the rest.
func clip(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n-1]) + "…"
}

func capitalize(s string) string {
	r, size := utf8.DecodeRuneInString(s)
	if size == 0 {
		return s
	}
	return string(unicode.ToUpper(r)) + s[size:]
}

// relative is path under root as from root, and any other as it is.
func relative(path, root string) string {
	if root == "" || !strings.HasPrefix(path, root+"/") {
		return path
	}
	return path[len(root)+1:]
}

// glimpsed is how many bytes at the end of the thinking a glimpse reads.
const glimpsed = 600

// glimpse is the last words of thinking being written: its last line,
// the end of it when long.
func glimpse(text string) string {
	tail := strings.TrimRightFunc(text[max(0, len(text)-glimpsed):], unicode.IsSpace)
	if i := strings.LastIndexByte(tail, '\n'); i >= 0 {
		tail = tail[i+1:]
	}
	tail = strings.TrimSpace(tail)
	if r := []rune(tail); len(r) > 120 {
		return "…" + string(r[len(r)-119:])
	}
	return tail
}
