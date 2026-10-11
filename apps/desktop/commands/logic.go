// Package commands is the menu of commands that opens as a `/` is typed, as the
// terminal's (apps/coding-agent/src/ui/menu.ts): the commands whose name or
// hint has what is typed, the names that start with it first, then the
// names that have it, then the hints. Past the name and a space, a command
// that takes one of a few things offers them instead. What matches is found
// apart from the drawing (view.go), so it is tested as plain data.
package commands

import (
	"regexp"
	"strings"

	"desktop/agent"
)

// Entry is a row of the menu: a command, or a choice of what the command
// being typed takes.
type Entry struct {
	Command agent.Command
	// The choice, while the command's argument is typed; empty otherwise.
	Choice string
	// Where what is typed was found, in bytes: in the name, in the hint, or
	// in the choice; -1 for nowhere.
	Name, Hint, Chose Span
}

// Span is the part of a text that matched; From is -1 for none.
type Span struct{ From, To int }

var none = Span{-1, -1}

var (
	// A command is being typed: a `/` and no space yet.
	typingName = regexp.MustCompile(`^/\S*$`)
	// Its argument is: the name, a space, and no other space yet.
	typingArg = regexp.MustCompile(`^(/\S+) (\S*)$`)
)

// Match is what the menu shows for the draft: none while no command is
// typed, or none matches.
func Match(commands []agent.Command, draft string) []Entry {
	if typingName.MatchString(draft) {
		return byName(commands, strings.ToLower(draft[1:]))
	}
	m := typingArg.FindStringSubmatch(draft)
	if m == nil {
		return nil
	}
	for _, c := range commands {
		if c.Name == m[1] {
			return byChoice(c, strings.ToLower(m[2]))
		}
	}
	return nil
}

// byName ranks the commands as the terminal's menu does, each rank in the
// commands' own order.
func byName(commands []agent.Command, query string) []Entry {
	var ranks [3][]Entry
	for _, c := range commands {
		name := spanOf(c.Name[1:], query)
		if name.From != -1 {
			// In the name past its `/`
			name = Span{name.From + 1, name.To + 1}
		}
		hint := spanOf(c.Hint, query)
		switch {
		case query == "":
			ranks[0] = append(ranks[0], Entry{Command: c, Name: none, Hint: none, Chose: none})
		case name.From == 1:
			ranks[0] = append(ranks[0], Entry{Command: c, Name: name, Hint: none, Chose: none})
		case name.From != -1:
			ranks[1] = append(ranks[1], Entry{Command: c, Name: name, Hint: none, Chose: none})
		case hint.From != -1:
			ranks[2] = append(ranks[2], Entry{Command: c, Name: none, Hint: hint, Chose: none})
		}
	}
	return append(append(ranks[0], ranks[1]...), ranks[2]...)
}

// byChoice is what a command takes that has what is typed, those that
// start with it first.
func byChoice(c agent.Command, query string) []Entry {
	var first, then []Entry
	for _, choice := range c.Choices {
		at := spanOf(choice, query)
		e := Entry{Command: c, Choice: choice, Name: none, Hint: none, Chose: at}
		if query == "" {
			e.Chose = none
		}
		switch at.From {
		case -1:
		case 0:
			first = append(first, e)
		default:
			then = append(then, e)
		}
	}
	return append(first, then...)
}

// spanOf is where query is in text, case aside; at 0 and empty for an
// empty query.
func spanOf(text, query string) Span {
	at := strings.Index(strings.ToLower(text), query)
	if at == -1 {
		return none
	}
	return Span{at, at + len(query)}
}

// Completion is what an entry puts in the input: a command and a space
// when it takes something, or the command and the choice.
func (e Entry) Completion() string {
	switch {
	case e.Choice != "":
		return e.Command.Name + " " + e.Choice
	case e.Command.Arg != "":
		return e.Command.Name + " "
	default:
		return e.Command.Name
	}
}

// Runs says whether Enter on the entry runs it, rather than completing it
// to take what comes next.
func (e Entry) Runs() bool { return e.Choice != "" || e.Command.Arg == "" }

// State is what the window keeps of a session's menu: the entry chosen,
// for the draft it was chosen in, and the draft Esc closed it at.
type State struct {
	Selected int
	draft    string
	closedAt string
	// The caret goes to the end of the draft in the next frame: after a
	// completion.
	ToEnd bool
}

// Entries is the menu for the draft, the first entry chosen again as the
// draft changes; none while Esc has closed it on this draft.
func (m *State) Entries(commands []agent.Command, draft string) []Entry {
	if draft != m.draft {
		m.Selected, m.draft = 0, draft
		if draft != m.closedAt {
			m.closedAt = ""
		}
	}
	if m.closedAt != "" && draft == m.closedAt {
		return nil
	}
	entries := Match(commands, draft)
	if m.Selected >= len(entries) {
		m.Selected = 0
	}
	return entries
}

// Move chooses the entry by steps from the one chosen, going round.
func (m *State) Move(by, count int) {
	if count > 0 {
		m.Selected = ((m.Selected+by)%count + count) % count
	}
}

// Complete puts the entry in the draft, the caret at its end.
func (m *State) Complete(draft *string, e Entry) {
	*draft = e.Completion()
	m.ToEnd = true
}

// Close hides the menu until the draft changes.
func (m *State) Close(draft string) { m.closedAt = draft }
