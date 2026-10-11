package commands

import (
	"reflect"
	"testing"

	"desktop/agent"
)

// commands are the service's commands, as a session lists them.
var commands = []agent.Command{
	{Name: "/think", Arg: "<off|high>", Hint: "sets thinking", Choices: []string{"off", "high"}},
	{Name: "/fast", Arg: "[on|off]", Hint: "answers faster, for more usage", Choices: []string{"on", "off"}},
	{Name: "/compact", Hint: "summarizes the conversation so far"},
	{Name: "/help", Hint: "lists keys, commands and tools"},
	{Name: "/exit", Hint: "quits"},
	{Name: "/login", Arg: "<provider>", Hint: "signs in: in the browser, or with a key typed in", Choices: []string{"deepseek", "openai", "openai-codex"}},
	{Name: "/impeccable", Arg: "[command]", Hint: "designs and polishes interfaces", Group: "Skills"},
}

func TestCommandMenuRanksAsTheTerminalDoes(t *testing.T) {
	names := func(draft string) []string {
		var out []string
		for _, e := range Match(commands, draft) {
			out = append(out, e.Completion())
		}
		return out
	}
	for _, c := range []struct {
		draft string
		want  []string
	}{
		// Every command for a `/`, in the service's order
		{"/", []string{"/think ", "/fast ", "/compact", "/help", "/exit", "/login ", "/impeccable "}},
		// Names that start with it, then names that have it, then hints that do
		{"/co", []string{"/compact", "/help"}},
		{"/in", []string{"/think ", "/login ", "/impeccable "}},
		// Past the name, what it takes
		{"/think ", []string{"/think off", "/think high"}},
		{"/login open", []string{"/login openai", "/login openai-codex"}},
		{"/login ai", []string{"/login openai", "/login openai-codex"}},
		// Nothing for a command that takes no choices, a message, or none that matches
		{"/impeccable ", nil},
		{"hello /th", nil},
		{"/zz", nil},
		{"/think high now", nil},
	} {
		if got := names(c.draft); !reflect.DeepEqual(got, c.want) {
			t.Errorf("%q: %q, want %q", c.draft, got, c.want)
		}
	}
}
