package app

// What the window keeps of each session it opened.

import (
	"slices"
	"strings"
	"sync/atomic"

	"github.com/egoist/mygo/ui"

	"desktop/agent"
	"desktop/commands"
	"desktop/conversation"
	"desktop/ui/components"
)

// sessionView is what the window keeps of a session it opened: its
// conversation, and what is typed and picked in it.
type sessionView struct {
	id   string
	stop func()
	// The events come in and not yet applied, and whether the session is
	// the one shown, which takes them in at once.
	inbox inbox
	shown atomic.Bool
	t     conversation.Transcript
	draft string
	list  ui.ListState
	// How tall what floats over the end of the conversation was in the
	// last frame: the questions and the input.
	bottom float32
	// The menu of commands, open while one is typed.
	menu commands.State
	// The inspector's place among the lines of the step it shows, which
	// starts at the top for each step; when Copy was last pressed; and
	// whether the input takes the keys back, as the inspector closes.
	inspectList   ui.ListState
	inspectedLast *conversation.Item
	copied        components.Copied
	refocus       bool
	answer        answerDraft
	// Whether what the session has spent is open over its gauge, and where
	// the gauge's arc runs down from.
	usageOpen  bool
	usageDrain components.Drain
}

// restore puts back what was typed and not sent, unless something else
// was typed meanwhile.
func (v *sessionView) restore(text string) {
	if v.draft == "" {
		v.draft = text
	}
}

// answerDraft is the answer being put together to the open questions: for
// each, the values picked and the text typed instead.
type answerDraft struct {
	id     string
	picks  [][]string
	others []string
}

// reset clears the answer once new questions come.
func (d *answerDraft) reset(asking *conversation.Asking) {
	if asking == nil || d.id == asking.ID {
		return
	}
	d.id = asking.ID
	d.picks = make([][]string, len(asking.Questions))
	d.others = make([]string, len(asking.Questions))
	for i, q := range asking.Questions {
		if !q.Multiple && len(q.Options) > 0 {
			d.picks[i] = []string{q.Options[0].Value}
		}
	}
}

// answers is what has been picked and typed: a typed answer stands in for
// the pick of a question that takes one.
func (d *answerDraft) answers(questions []agent.Question) [][]string {
	out := make([][]string, len(d.picks))
	for i, picked := range d.picks {
		other := strings.TrimSpace(d.others[i])
		multiple := questions[i].Multiple
		switch {
		case other != "" && !multiple:
			out[i] = []string{other}
		case other != "":
			out[i] = append(slices.Clone(picked), other)
		default:
			out[i] = slices.Clone(picked)
		}
	}
	return out
}

func (d *answerDraft) toggle(question int, value string, multiple bool) {
	if !multiple {
		d.picks[question] = []string{value}
		d.others[question] = ""
		return
	}
	if i := slices.Index(d.picks[question], value); i >= 0 {
		d.picks[question] = slices.Delete(d.picks[question], i, i+1)
		return
	}
	d.picks[question] = append(d.picks[question], value)
}

func (d *answerDraft) picked(question int, value string) bool {
	return slices.Contains(d.picks[question], value)
}
