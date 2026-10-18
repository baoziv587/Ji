package app

// What the controls do to sessions: start, archive, send, answer.

import (
	"context"
	"strings"

	"desktop/agent"
)

// NewSession starts a session in root, the chosen session's folder when
// empty, on the default model of the settings, and shows it.
func (a *App) NewSession(root string) {
	if root == "" {
		if s, ok := a.session(a.selected); ok {
			root = s.Root
		}
	}
	model := a.Settings.Model
	a.call(func(ctx context.Context) error {
		s, err := a.agent.CreateSession(ctx, root, model)
		if err == nil {
			a.update(func() {
				if _, listed := a.session(s.ID); !listed {
					a.list.Sessions = append([]agent.Session{s}, a.list.Sessions...)
					a.regroup()
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

// OpenFolder shows a folder's sessions, as `ji app` asks: its section
// first and open, its most recent session chosen, or a new one in it when
// it has none. The list is read again first, for the sessions made since.
func (a *App) OpenFolder(root string) {
	a.settingsOpen = false
	a.request(func(ctx context.Context) {
		list, err := a.agent.Sessions(ctx)
		a.update(func() {
			if err != nil {
				a.failure = err.Error()
				return
			}
			a.pinned = root
			a.setList(list)
			if open := a.opened[root]; open != nil {
				*open = true
			}
			var recent *agent.Session
			for i, s := range a.list.Sessions {
				if s.Root == root && !s.Archived && (recent == nil || s.Updated > recent.Updated) {
					recent = &a.list.Sessions[i]
				}
			}
			if recent == nil {
				a.NewSession(root)
				return
			}
			a.Select(recent.ID)
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
			a.close(id)
			a.toast = &toast{
				message: "Archived “" + titleOf(s) + "”",
				action:  "Undo",
				run:     func() { a.unarchive(id) },
			}
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
			a.regroup()
			return
		}
	}
}

// neighbour is the session after id as the sidebar shows them, or the one
// before it at the end: what to show once id is archived. None when id is
// the only one.
func (a *App) neighbour(id string) string {
	var shown []string
	for _, g := range a.groups().folders {
		for _, i := range g.sessions {
			shown = append(shown, a.list.Sessions[i].ID)
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
func (a *App) send(view *sessionView) {
	text := strings.TrimSpace(view.draft)
	if text == "" {
		return
	}
	if strings.HasPrefix(text, "/") {
		a.command(view, text)
		return
	}

	view.draft = ""
	a.call(func(ctx context.Context) error {
		_, err := a.agent.Send(ctx, view.id, text)
		if err != nil {
			a.update(func() { view.restore(text) })
		}
		return err
	})
}

// command runs the command the line names: the service runs it, but /exit
// quits the app here.
func (a *App) command(view *sessionView, line string) {
	view.draft = ""
	if strings.Fields(line)[0] == "/exit" && a.Quit != nil {
		a.Quit()
		return
	}

	a.call(func(ctx context.Context) error {
		_, err := a.agent.Command(ctx, view.id, line)
		if err != nil {
			a.update(func() { view.restore(line) })
		}
		return err
	})
}

func (a *App) stop(id string) {
	a.call(func(ctx context.Context) error { return a.agent.Stop(ctx, id) })
}

// switchMode switches the session between ask and auto, as ⇧⇥ does in the
// terminal; out of yolo, back to ask.
func (a *App) switchMode(view *sessionView) {
	mode := "ask"
	if view.t.State.Mode == "ask" {
		mode = "auto"
	}
	a.callState(
		view,
		func(ctx context.Context) (agent.State, error) {
			return a.agent.SetMode(ctx, view.id, mode)
		},
	)
}

func (a *App) think(view *sessionView, level string) {
	a.callState(
		view,
		func(ctx context.Context) (agent.State, error) {
			return a.agent.Think(ctx, view.id, level)
		},
	)
}

// answer replies to the session's open questions; nil dismisses them.
func (a *App) answer(view *sessionView, answers [][]string) {
	asking := view.t.Asking
	if asking == nil {
		return
	}
	a.call(
		func(ctx context.Context) error { return a.agent.Answer(ctx, view.id, asking.ID, answers) },
	)
}
