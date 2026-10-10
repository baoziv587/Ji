package agentui

// The window's state and what its controls do. Every call to the service
// runs off the main thread; what comes of it is put back through update,
// which runs on the main thread and draws a new frame.

import (
	"context"
	"strings"
	"time"

	"github.com/egoist/mygo/ui"
)

// App is the window: the list of sessions, and the one chosen.
type App struct {
	agent Agent
	// update runs fn on the main thread, then draws: Window.Update.
	update func(fn func())
	// async runs fn off the main thread: a goroutine, or at once in tests.
	async func(fn func())
	// ChooseFolder asks for a folder to start a session in: "" when the
	// person cancels. Nil leaves the choice out.
	ChooseFolder func() (string, error)

	ctx         context.Context
	list        Sessions
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

// sessionView is what the window keeps of a session it opened: its
// conversation, and what is typed and picked in it.
type sessionView struct {
	t      Transcript
	draft  string
	scroll ui.ScrollState
	// The answer being put together to the open questions: for each, the
	// values picked and the text typed instead.
	answering string
	picks     [][]string
	others    []string
}

func NewApp(agent Agent, update func(func())) *App {
	return &App{
		agent:       agent,
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
	a.agent.FollowSessions(ctx, func(s Sessions) {
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

func (a *App) setList(s Sessions) {
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
		a.agent.Follow(ctx, id, 0, func(e Event) {
			a.update(func() { a.apply(view, e) })
		})
	})
}

func (a *App) apply(view *sessionView, e Event) {
	if !view.t.Apply(e) {
		return
	}
	// A reply that did not finish gives its messages back, ahead of what is typed
	view.draft = strings.TrimSpace(strings.Join([]string{view.t.Unsent, view.draft}, " "))
}

func (a *App) session(id string) (Session, bool) {
	for _, s := range a.list.Sessions {
		if s.ID == id {
			return s, true
		}
	}
	return Session{}, false
}

// current is the session chosen and its view; ok is false with none.
func (a *App) current() (Session, *sessionView, bool) {
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
func (a *App) callState(view *sessionView, action func(ctx context.Context) (State, error)) {
	a.call(func(ctx context.Context) error {
		s, err := action(ctx)
		if err == nil {
			a.update(func() { view.t.State = s })
		}
		return err
	})
}

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
					a.list.Sessions = append([]Session{s}, a.list.Sessions...)
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
				a.Select(next)
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

func (a *App) replace(s Session) {
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

func (a *App) send(id string, view *sessionView) {
	text := strings.TrimSpace(view.draft)
	if text == "" {
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

func (a *App) stop(id string) {
	a.call(func(ctx context.Context) error { return a.agent.Stop(ctx, id) })
}

func (a *App) switchMode(id string, view *sessionView) {
	a.callState(view, func(ctx context.Context) (State, error) { return a.agent.SwitchMode(ctx, id) })
}

func (a *App) think(id string, view *sessionView, level string) {
	a.callState(view, func(ctx context.Context) (State, error) { return a.agent.Think(ctx, id, level) })
}

// answer replies to the session's open questions; nil dismisses them.
func (a *App) answer(id string, view *sessionView, answers [][]string) {
	asking := view.t.Asking
	if asking == nil {
		return
	}
	a.call(func(ctx context.Context) error { return a.agent.Answer(ctx, id, asking.ID, answers) })
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
