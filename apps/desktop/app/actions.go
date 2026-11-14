package app

// What the controls do to sessions: start, archive, delete, send, answer.

import (
	"context"
	"slices"
	"strings"
	"time"

	"desktop/agent"
)

// NewSession shows a new session in root, the chosen session's folder when
// empty, on the default model of the settings at the service's thinking
// level: a draft of the window's, which the service makes a session of as
// its first message is sent. One draft at a time, what is typed and picked
// in it kept.
func (a *App) NewSession(root string) {
	if root == "" {
		if s, ok := a.session(a.selected); ok {
			root = s.Root
		}
	}
	if root == "" {
		root = a.list.DefaultRoot
	}
	// A folder gone gives way to its project's where it is now
	if a.isMissing(root) {
		if live := a.liveFolder(root); live != "" {
			root = live
		}
	}
	view := a.views[draftID]
	if view == nil {
		view = &sessionView{id: draftID, stop: func() {}}
		view.t.State = agent.State{ID: draftID, Mode: a.Settings.Approvals}
		a.views[draftID] = view
		a.chooseModel(view, a.Settings.Model)
	}
	view.t.State.Root = root
	view.refocus = true
	a.Select(draftID)
}

// start makes the draft a session of the service's, in its folder, on the
// model, at the thinking level and in the mode picked for it, with the
// message or command sent first; then shows it in the draft's place, its
// panel and the files left attached with it. A command leaves the files
// for the next message, as in a session.
func (a *App) start(view *sessionView, text string) {
	if view.starting {
		return
	}
	view.starting = true
	st, approvals := view.t.State, a.Settings.Approvals
	command := strings.HasPrefix(text, "/")
	var attached []attachment
	if !command {
		attached, view.files = view.files, nil
	}
	view.draft = ""
	a.failure = ""
	a.request(func(ctx context.Context) {
		s, err := a.agent.CreateSession(ctx, agent.NewSession{
			Root:     st.Root,
			Model:    st.Model,
			Thinking: st.Thinking,
		})
		if err != nil {
			a.update(func() {
				view.starting = false
				view.restoreMessage(text, attached)
				a.failure = err.Error()
			})
			return
		}
		if st.Mode != "" && st.Mode != approvals {
			_, err = a.agent.SetMode(ctx, s.ID, st.Mode)
		}
		if err == nil {
			if command {
				_, err = a.agent.Command(ctx, s.ID, text)
			} else {
				_, err = a.agent.Send(ctx, s.ID, text, pathsOf(attached))
			}
		}
		a.update(func() {
			if _, listed := a.session(s.ID); !listed {
				a.list.Sessions = append([]agent.Session{s}, a.list.Sessions...)
				a.regroup()
			}
			delete(a.views, draftID)
			if a.selected == draftID {
				a.Select(s.ID)
			} else {
				a.open(s.ID)
			}
			started := a.views[s.ID]
			started.panel, started.files = view.panel, view.files
			if err != nil {
				started.restoreMessage(text, attached)
				a.failure = err.Error()
			}
		})
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
			if open := a.opened[a.groupKeyOf(root)]; open != nil {
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

// archive settles a session out of the list's way, or puts it back. One
// settled while chosen gives way to the next, and a toast can take it back.
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
				message: "Settled “" + titleOf(s) + "”",
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
	groups := a.groups()
	var shown []string
	for _, i := range groups.pinned {
		shown = append(shown, a.list.Sessions[i].ID)
	}
	for _, g := range groups.folders {
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

// send sends what is typed, with the files attached: a message, or the
// command it names, which leaves the files for the next message.
func (a *App) send(view *sessionView) {
	if !view.sendable() {
		return
	}
	text := strings.TrimSpace(view.draft)
	if strings.HasPrefix(text, "/") {
		a.command(view, text)
		return
	}
	if view.id == draftID {
		a.start(view, text)
		return
	}

	view.draft = ""
	attached := view.files
	view.files = nil
	a.call(func(ctx context.Context) error {
		_, err := a.agent.Send(ctx, view.id, text, pathsOf(attached))
		if err != nil {
			a.update(func() { view.restoreMessage(text, attached) })
		}
		return err
	})
}

// command runs the command the line names: the service runs it, but /exit
// quits the app here.
func (a *App) command(view *sessionView, line string) {
	view.draft = ""
	if a.quits(line) {
		a.Quit()
		return
	}
	if view.id == draftID {
		a.start(view, line)
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

// quits is whether the command line is /exit, which quits the app here.
func (a *App) quits(line string) bool {
	fields := strings.Fields(line)
	return len(fields) > 0 && fields[0] == "/exit" && a.Quit != nil
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
	a.setMode(view, mode)
}

// setMode sets the session's mode: ask, auto or yolo, which the window
// calls Full access.
func (a *App) setMode(view *sessionView, mode string) {
	if view.id == draftID {
		view.t.State.Mode = mode
		return
	}
	a.callState(
		view,
		func(ctx context.Context) (agent.State, error) {
			return a.agent.SetMode(ctx, view.id, mode)
		},
	)
}

func (a *App) think(view *sessionView, level string) {
	if view.id == draftID {
		view.t.State.Thinking = level
		return
	}
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

// remove deletes a session for good once the person says so: the window
// shows the one beside it, and it leaves the list and the pins.
func (a *App) remove(s agent.Session) {
	confirm, title := a.ConfirmDelete, titleOf(s)
	a.async(func() {
		if !confirm(title) {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		err := a.agent.Delete(ctx, s.ID)
		a.update(func() {
			if err != nil {
				a.toast = &toast{message: "Could not delete “" + title + "”: " + err.Error()}
				return
			}
			a.forget(s.ID)
			a.toast = &toast{message: "Deleted “" + title + "”"}
		})
	})
}

// forget lets go of a session deleted.
func (a *App) forget(id string) {
	next := a.neighbour(id)
	a.list.Sessions = slices.DeleteFunc(
		a.list.Sessions,
		func(s agent.Session) bool { return s.ID == id },
	)
	a.regroup()
	if a.isPinned(id) {
		a.pin(id, false)
	}
	if a.selected == id {
		a.selected = ""
		a.show(next)
	}
	a.close(id)
}

// pin keeps a session over the folders, or puts it back under its own.
func (a *App) pin(id string, on bool) {
	pins := slices.DeleteFunc(slices.Clone(a.Pins), func(p string) bool { return p == id })
	if on {
		pins = append(pins, id)
	}
	a.Pins = pins
	a.regroup()
	if save := a.SavePins; save != nil {
		a.async(func() { save(pins) })
	}
}

func (a *App) isPinned(id string) bool { return slices.Contains(a.Pins, id) }
