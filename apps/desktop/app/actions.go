package app

// What the controls do to sessions: start, archive, send, answer.

import (
	"context"
	"strings"

	"desktop/agent"
)

// NewSession starts a session in root, the chosen session's folder when
// empty, and shows it.
func (a *App) NewSession(root string) {
	if root == "" {
		if s, ok := a.session(a.selected); ok {
			root = s.Root
		}
	}
	a.call(func(ctx context.Context) error {
		s, err := a.agent.CreateSession(ctx, root)
		if err == nil {
			a.update(func() {
				if _, listed := a.session(s.ID); !listed {
					a.list.Sessions = append([]agent.Session{s}, a.list.Sessions...)
				}
				a.Select(s.ID)
			})
		}
		return err
	})
}

// NewSessionInFolder asks for a folder, then starts a session in it.
func (a *App) NewSessionInFolder() {
	if a.ChooseFolder == nil {
		return
	}
	a.async(func() {
		folder, err := a.ChooseFolder()
		a.update(func() {
			switch {
			case err != nil:
				a.failure = err.Error()
			case folder != "":
				a.NewSession(folder)
			}
		})
	})
}

// archive takes a session out of the list's way, or puts it back. One
// archived while chosen gives way to the next, and a toast can take it back.
func (a *App) archive(id string, archived bool) {
	next := a.neighbour(id)
	a.call(func(ctx context.Context) error {
		s, err := a.agent.Archive(ctx, id, archived)
		if err != nil {
			return err
		}
		a.update(func() {
			a.replace(s)
			if !archived {
				return
			}
			if a.selected == id {
				a.selected = ""
				a.show(next)
			}
			a.toast = &toast{message: "Archived “" + titleOf(s) + "”", action: "Undo", run: func() { a.unarchive(id) }}
		})
		return nil
	})
}

func (a *App) unarchive(id string) {
	a.archive(id, false)
	a.Select(id)
}

func (a *App) replace(s agent.Session) {
	for i := range a.list.Sessions {
		if a.list.Sessions[i].ID == s.ID {
			a.list.Sessions[i] = s
			return
		}
	}
}

// neighbour is the session after id as the sidebar shows them, or the one
// before it at the end: what to show once id is archived. None when id is
// the only one.
func (a *App) neighbour(id string) string {
	groups, _ := a.groups()
	var shown []string
	for _, g := range groups {
		for _, s := range g.sessions {
			shown = append(shown, s.ID)
		}
	}
	for i, other := range shown {
		if other != id {
			continue
		}
		switch {
		case i+1 < len(shown):
			return shown[i+1]
		case i > 0:
			return shown[i-1]
		}
	}
	return ""
}

// send sends what is typed: a message, or the command it names.
func (a *App) send(id string, view *sessionView) {
	text := strings.TrimSpace(view.draft)
	if text == "" {
		return
	}
	if strings.HasPrefix(text, "/") {
		a.command(id, view, text)
		return
	}
	view.draft = ""
	a.call(func(ctx context.Context) error {
		_, err := a.agent.Send(ctx, id, text)
		if err != nil {
			// Not sent: back in the input, unless something else was typed meanwhile
			a.update(func() {
				if view.draft == "" {
					view.draft = text
				}
			})
		}
		return err
	})
}

// command runs the command the line names: the service runs it, but /exit
// quits the app here.
func (a *App) command(id string, view *sessionView, line string) {
	view.draft = ""
	if strings.Fields(line)[0] == "/exit" && a.Quit != nil {
		a.Quit()
		return
	}
	a.call(func(ctx context.Context) error {
		_, err := a.agent.Command(ctx, id, line)
		if err != nil {
			a.update(func() {
				if view.draft == "" {
					view.draft = line
				}
			})
		}
		return err
	})
}

func (a *App) stop(id string) {
	a.call(func(ctx context.Context) error { return a.agent.Stop(ctx, id) })
}

func (a *App) switchMode(id string, view *sessionView) {
	a.callState(view, func(ctx context.Context) (agent.State, error) { return a.agent.SwitchMode(ctx, id) })
}

func (a *App) think(id string, view *sessionView, level string) {
	a.callState(view, func(ctx context.Context) (agent.State, error) { return a.agent.Think(ctx, id, level) })
}

// answer replies to the session's open questions; nil dismisses them.
func (a *App) answer(id string, view *sessionView, answers [][]string) {
	asking := view.t.Asking
	if asking == nil {
		return
	}
	a.call(func(ctx context.Context) error { return a.agent.Answer(ctx, id, asking.ID, answers) })
}
