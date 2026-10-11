package app

// What the window keeps of each session it opened.

import (
	"strings"

	"github.com/egoist/mygo/ui"

	"desktop/commands"
	"desktop/conversation"
)

// sessionView is what the window keeps of a session it opened: its
// conversation, and what is typed and picked in it.
type sessionView struct {
	t     conversation.Transcript
	draft string
	list  ui.ListState
	// The menu of commands, open while one is typed.
	menu commands.State
	// The answer being put together to the open questions: for each, the
	// values picked and the text typed instead.
	answering string
	picks     [][]string
	others    []string
}

// startAnswering clears the answer being put together once new questions come.
func (v *sessionView) startAnswering() {
	asking := v.t.Asking
	if asking == nil || v.answering == asking.ID {
		return
	}
	v.answering = asking.ID
	v.picks = make([][]string, len(asking.Questions))
	v.others = make([]string, len(asking.Questions))
	for i, q := range asking.Questions {
		if !q.Multiple && len(q.Options) > 0 {
			v.picks[i] = []string{q.Options[0].Value}
		}
	}
}

// answers is what has been picked and typed: a typed answer stands in for
// the pick of a question that takes one.
func (v *sessionView) answers() [][]string {
	out := make([][]string, len(v.picks))
	for i, picked := range v.picks {
		other := strings.TrimSpace(v.others[i])
		multiple := v.t.Asking.Questions[i].Multiple
		switch {
		case other != "" && !multiple:
			out[i] = []string{other}
		case other != "":
			out[i] = append(append([]string{}, picked...), other)
		default:
			out[i] = append([]string{}, picked...)
		}
	}
	return out
}

func (v *sessionView) toggle(question int, value string, multiple bool) {
	if !multiple {
		v.picks[question] = []string{value}
		v.others[question] = ""
		return
	}
	for i, picked := range v.picks[question] {
		if picked == value {
			v.picks[question] = append(v.picks[question][:i:i], v.picks[question][i+1:]...)
			return
		}
	}
	v.picks[question] = append(v.picks[question], value)
}

func (v *sessionView) picked(question int, value string) bool {
	for _, picked := range v.picks[question] {
		if picked == value {
			return true
		}
	}
	return false
}
