// Package agentui is the window of Ji Agent: the coding agent's sessions,
// read from its HTTP service and drawn with MyGo's native UI.
package agentui

// The window's state and what its controls do. Every call to the service
// runs off the main thread; what comes of it is put back through update,
// which runs on the main thread and draws a new frame.

import (
	"context"
	"strings"
	"time"

	"github.com/egoist/mygo/ui"

	"desktop/agentui/agent"
)

// App is the window: the list of sessions, and the one chosen.
type App struct {
	agent agent.Agent
	// update runs fn on the main thread, then draws: Window.Update.
	update func(fn func())
	// async runs fn off the main thread: a goroutine, or at once in tests.
	async func(fn func())
	// ChooseFolder asks for a folder to start a session in: "" when the
	// person cancels. Nil leaves the choice out.
	ChooseFolder func() (string, error)
	// Quit ends the app, as /exit does in the terminal. Nil leaves /exit to
	// the service, which says there is nothing to quit.
	Quit func()

	ctx         context.Context
	list        agent.Sessions
	listed      bool
	connected   bool
	connection  string
	failure     string
	selected    string
	views       map[string]*sessionView
	SidebarSize float32
	// Whether each folder's section of the sidebar is open, by folder; the
	// archived section is closed until opened.
	opened       map[string]*bool
	archivedOpen bool
	// A toast to show in the next frame, which only the view can.
	toast *toast
	// The theme made for the system's, light or dark, until it changes.
	theme *ui.Theme
}

type toast struct {
	message, action string
	run             func()
}

func NewApp(service agent.Agent, update func(func())) *App {
	return &App{
		agent:       service,
		update:      update,
		async:       func(fn func()) { go fn() },
		ctx:         context.Background(),
		views:       map[string]*sessionView{},
		opened:      map[string]*bool{},
		SidebarSize: 260,
	}
}

// Follow reads the list of sessions until ctx ends, and opens the most
// recent one.
func (a *App) Follow(ctx context.Context) {
	a.update(func() { a.ctx = ctx })
	a.agent.FollowSessions(ctx, func(s agent.Sessions) {
		a.update(func() { a.setList(s) })
	}, func(err error) {
		a.update(func() {
			a.connected = err == nil
			a.connection = ""
			if err != nil {
				a.connection = "Cannot reach the agent: " + err.Error()
			}
		})
	})
}

func (a *App) setList(s agent.Sessions) {
	a.list, a.listed = s, true
	if a.selected == "" {
		for _, session := range s.Sessions {
			if !session.Archived {
				a.Select(session.ID)
				break
			}
		}
	}
}

// Select shows a session, reading it from the service the first time.
func (a *App) Select(id string) {
	a.selected = id
	a.open(id)
}

// open follows a session's events for as long as the window runs: one left
// in the background keeps up, and shows at once when chosen again.
func (a *App) open(id string) {
	if id == "" || a.views[id] != nil {
		return
	}
	view := &sessionView{}
	a.views[id] = view
	ctx := a.ctx
	a.async(func() {
		a.agent.Follow(ctx, id, 0, func(e agent.Event) {
			a.update(func() { a.apply(view, e) })
		})
	})
}

func (a *App) apply(view *sessionView, e agent.Event) {
	if !view.t.Apply(e) {
		return
	}
	// A reply that did not finish gives its messages back, ahead of what is typed
	view.draft = strings.TrimSpace(strings.Join([]string{view.t.Unsent, view.draft}, " "))
}

func (a *App) session(id string) (agent.Session, bool) {
	for _, s := range a.list.Sessions {
		if s.ID == id {
			return s, true
		}
	}
	return agent.Session{}, false
}

// current is the session chosen and its view; ok is false with none.
func (a *App) current() (agent.Session, *sessionView, bool) {
	s, ok := a.session(a.selected)
	view := a.views[a.selected]
	return s, view, ok && view != nil
}

// call runs an action of the service, and shows its error if it fails.
func (a *App) call(action func(ctx context.Context) error) {
	a.failure = ""
	a.async(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		err := action(ctx)
		a.update(func() {
			if err != nil {
				a.failure = err.Error()
			}
		})
	})
}

// callState runs an action that answers with a session's new state.
func (a *App) callState(view *sessionView, action func(ctx context.Context) (agent.State, error)) {
	a.call(func(ctx context.Context) error {
		s, err := action(ctx)
		if err == nil {
			a.update(func() { view.t.State = s })
		}
		return err
	})
}
