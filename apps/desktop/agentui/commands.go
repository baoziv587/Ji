package agentui

// The menu of commands that opens as a `/` is typed, as the terminal's
// (apps/coding-agent/src/ui/menu.ts): the commands whose name or hint has
// what is typed, the names that start with it first, then the names that
// have it, then the hints. Past the name and a space, a command that takes
// one of a few things offers them instead. No drawing here, so it is
// tested as plain data.

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

// menuEntry is a row of the menu: a command, or a choice of what the
// command being typed takes.
type menuEntry struct {
	Command Command
	// The choice, while the command's argument is typed; empty otherwise.
	Choice string
	// Where what is typed was found, in bytes: in the name, in the hint, or
	// in the choice; -1 for nowhere.
	Name, Hint, Chose span
}

// span is the part of a text that matched; From is -1 for none.
type span struct{ From, To int }

var none = span{-1, -1}

var (
	// A command is being typed: a `/` and no space yet.
	typingName = regexp.MustCompile(`^/\S*$`)
	// Its argument is: the name, a space, and no other space yet.
	typingArg = regexp.MustCompile(`^(/\S+) (\S*)$`)
)

// commandMenu is what the menu shows for the draft: none while no command
// is typed, or none matches.
func commandMenu(commands []Command, draft string) []menuEntry {
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
func byName(commands []Command, query string) []menuEntry {
	var ranks [3][]menuEntry
	for _, c := range commands {
		name := spanOf(c.Name[1:], query)
		if name.From != -1 {
			// In the name past its `/`
			name = span{name.From + 1, name.To + 1}
		}
		hint := spanOf(c.Hint, query)
		switch {
		case query == "":
			ranks[0] = append(ranks[0], menuEntry{Command: c, Name: none, Hint: none, Chose: none})
		case name.From == 1:
			ranks[0] = append(ranks[0], menuEntry{Command: c, Name: name, Hint: none, Chose: none})
		case name.From != -1:
			ranks[1] = append(ranks[1], menuEntry{Command: c, Name: name, Hint: none, Chose: none})
		case hint.From != -1:
			ranks[2] = append(ranks[2], menuEntry{Command: c, Name: none, Hint: hint, Chose: none})
		}
	}
	return append(append(ranks[0], ranks[1]...), ranks[2]...)
}

// byChoice is what a command takes that has what is typed, those that
// start with it first.
func byChoice(c Command, query string) []menuEntry {
	var first, then []menuEntry
	for _, choice := range c.Choices {
		at := spanOf(choice, query)
		e := menuEntry{Command: c, Choice: choice, Name: none, Hint: none, Chose: at}
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
func spanOf(text, query string) span {
	at := strings.Index(strings.ToLower(text), query)
	if at == -1 {
		return none
	}
	return span{at, at + len(query)}
}

// completion is what an entry puts in the input: a command and a space
// when it takes something, or the command and the choice.
func (e menuEntry) completion() string {
	switch {
	case e.Choice != "":
		return e.Command.Name + " " + e.Choice
	case e.Command.Arg != "":
		return e.Command.Name + " "
	default:
		return e.Command.Name
	}
}

// runs says whether Enter on the entry runs it, rather than completing it
// to take what comes next.
func (e menuEntry) runs() bool { return e.Choice != "" || e.Command.Arg == "" }

// menuState is what the window keeps of a session's menu: the entry
// chosen, for the draft it was chosen in, and the draft Esc closed it at.
type menuState struct {
	selected int
	draft    string
	closedAt string
	// The caret goes to the end of the draft in the next frame: after a
	// completion.
	toEnd bool
}

// entries is the menu for the draft, the first entry chosen again as the
// draft changes; none while Esc has closed it on this draft.
func (m *menuState) entries(commands []Command, draft string) []menuEntry {
	if draft != m.draft {
		m.selected, m.draft = 0, draft
		if draft != m.closedAt {
			m.closedAt = ""
		}
	}
	if m.closedAt != "" && draft == m.closedAt {
		return nil
	}
	entries := commandMenu(commands, draft)
	if m.selected >= len(entries) {
		m.selected = 0
	}
	return entries
}

// move chooses the entry by steps from the one chosen, going round.
func (m *menuState) move(by, count int) {
	if count > 0 {
		m.selected = ((m.selected+by)%count + count) % count
	}
}

// complete puts the entry in the draft, the caret at its end.
func (m *menuState) complete(draft *string, e menuEntry) {
	*draft = e.completion()
	m.toEnd = true
}

// close hides the menu until the draft changes.
func (m *menuState) close(draft string) { m.closedAt = draft }

// runeCount is where the end of s is, as a text input counts.
func runeCount(s string) int { return utf8.RuneCountInString(s) }
