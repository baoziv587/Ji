// Package app is the window of Ji Agent: the coding agent's sessions,
// read from its HTTP service and drawn with MyGo's native UI.
package app

// The window's state and what its controls do. Every call to the service
// runs off the main thread; what comes of it is put back through update,
// which runs on the main thread and draws a new frame.

import (
	"context"
	"strings"
	"sync"
	"time"

	"desktop/agent"
	"desktop/syntax"
	"desktop/ui/components"
)

// App is the window: the list of sessions, and the one chosen.
type App struct {
	agent agent.Agent
	// update runs fn on the main thread, then draws: Window.Update.
	update func(fn func())
	// async runs fn off the main thread: a goroutine, or at once in tests;
	// after does it once d has passed.
	async func(fn func())
	after func(d time.Duration, fn func())
	// ChooseFolder asks for a folder to start a session in: "" when the
	// person cancels. Nil leaves the choice out.
	ChooseFolder func() (string, error)
	// Quit ends the app, as /exit does in the terminal. Nil leaves /exit to
	// the service, which says there is nothing to quit.
	Quit func()

	ctx      context.Context
	list     agent.Sessions
	listed   bool
	link     link
	failure  string
	selected string
	views    map[string]*sessionView
	grouped  *grouping
	// The sessions followed, the one shown last first.
	recent []string
	Layout Layout
	// Whether the inspector's edge is being dragged.
	resizing bool
	// Whether each folder's section of the sidebar is open, by folder; the
	// archived section is closed until opened.
	opened       map[string]*bool
	archivedOpen bool
	// The folder `ji app` opened last, whose section the sidebar shows
	// first.
	pinned string
	// A toast to show in the next frame, which only the view can.
	toast *toast
	// Settings are the person's choices; SaveSettings keeps them once
	// changed, nil for this run only.
	Settings     Settings
	SaveSettings func(Settings)
	saved        Settings
	settingsOpen bool
	// The page of the settings shown, kept while they are closed.
	settingsPage string
	// The transparency slider is held: what it sets is kept once let go,
	// not on every frame of the drag.
	sliding bool
	look
	// The providers, and the models of those a picker showed; whether the
	// settings show those not detected.
	catalog    catalog
	othersOpen bool
	// The picker of the default model, in the settings.
	defaults modelPicker
	// The form adding a provider while open; the provider whose removal
	// waits for a second yes, and whether it is under way; what the last
	// change of the providers did.
	adding       *providerForm
	removing     string
	removingBusy bool
	providerNote providerNote
}

// link is whether the service answers, and what is wrong while it does not.
type link struct {
	up      bool
	problem string
}

func (l *link) set(err error) {
	l.up, l.problem = err == nil, ""
	if err != nil {
		l.problem = "Cannot reach the agent: " + err.Error()
	}
}

func (l link) tooltip() string {
	if l.up {
		return "Connected to the agent"
	}
	return "Not connected to the agent"
}

// Layout is what of the window's arrangement lasts from one run to the
// next: how wide the sidebar is, and the inspector beside the
// conversation. The window's own frame MyGo keeps (StateKey).
type Layout struct {
	Sidebar   float32 `json:"sidebar"`
	Inspector float32 `json:"inspector"`
}

var DefaultLayout = Layout{Sidebar: 260, Inspector: 400}

const sidebarMin = 180

// Fit is l with a size too small to use put back to its default.
func (l Layout) Fit() Layout {
	if l.Sidebar < sidebarMin {
		l.Sidebar = DefaultLayout.Sidebar
	}
	if l.Inspector < inspectorMin {
		l.Inspector = DefaultLayout.Inspector
	}
	return l
}

type toast struct {
	message, action string
	run             func()
}

func New(service agent.Agent, update func(func())) *App {
	// Code colored in the background shows as it is
	syntax.Ready = func() { update(func() {}) }
	return &App{
		agent:    service,
		update:   update,
		async:    func(fn func()) { go fn() },
		after:    func(d time.Duration, fn func()) { time.AfterFunc(d, fn) },
		ctx:      context.Background(),
		views:    map[string]*sessionView{},
		opened:   map[string]*bool{},
		Layout:   DefaultLayout,
		Settings: DefaultSettings,
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
			a.link.set(err)
			// The service keeps no mode of the window's, and may have started again
			if err == nil {
				a.applyApprovals()
			}
		})
	})
}

func (a *App) setList(s agent.Sessions) {
	a.list, a.listed = s, true
	a.regroup()
	if a.selected == "" {
		for _, session := range s.Sessions {
			if !session.Archived {
				a.show(session.ID)
				break
			}
		}
	}
}

// Select shows a session, in place of the settings, reading it from the
// service the first time.
func (a *App) Select(id string) {
	a.settingsOpen = false
	a.show(id)
}

func (a *App) show(id string) {
	if was := a.views[a.selected]; was != nil {
		was.shown.Store(false)
	}
	a.selected = id
	a.open(id)
	if view := a.views[id]; view != nil {
		view.shown.Store(true)
		a.drain(view)
	}
	a.keep(id)
}

// keptViews is how many sessions the window follows besides the one
// shown. One left in the background keeps up and shows at once when
// chosen again; past these, the idle ones are let go of, their
// conversations with them, and read again when chosen.
const keptViews = 8

// keep puts id first among the sessions shown last, and lets go of those
// past keptViews that are idle with nothing typed.
func (a *App) keep(id string) {
	if id == "" {
		return
	}

	recent := []string{id}
	for _, other := range a.recent {
		view := a.views[other]
		switch {
		case other == id || view == nil:
		case len(recent) <= keptViews || view.draft != "" || a.busy(other):
			recent = append(recent, other)
		default:
			a.close(other)
		}
	}
	a.recent = recent
}

func (a *App) busy(id string) bool {
	s, _ := a.session(id)
	return isBusy(a.status(s))
}

// isBusy is whether a session with this status is in the middle of a
// reply, here or in the terminal.
func isBusy(status string) bool {
	return status == "running" || status == "asking" || status == "terminal"
}

// open follows a session's events until it is closed.
func (a *App) open(id string) {
	if id == "" || a.views[id] != nil {
		return
	}

	ctx, stop := context.WithCancel(a.ctx)
	view := &sessionView{id: id, stop: stop}
	a.views[id] = view

	drain := func() { a.update(func() { a.drain(view) }) }
	a.async(func() {
		a.agent.Follow(ctx, id, 0, func(e agent.Event) {
			switch {
			case !view.inbox.put(e):
			case view.shown.Load():
				// Taken in on the spinners' tick: the deltas of a reply come
				// faster than it, and those come meanwhile show in its frame
				a.after(components.UntilTick(time.Now()), drain)
			default:
				a.after(backgroundEvery, drain)
			}
		})
	})
}

// backgroundEvery is how often a session not shown takes in its events:
// one writing a reply behind the one shown would else build the window
// again for each delta of it, which none sees.
const backgroundEvery = 250 * time.Millisecond

// drain applies the events of the session come in since the last time.
func (a *App) drain(view *sessionView) {
	for _, e := range view.inbox.take() {
		a.apply(view, e)
	}
}

// close stops following a session and lets go of what the window keeps of it.
func (a *App) close(id string) {
	if view := a.views[id]; view != nil {
		view.stop()
		delete(a.views, id)
	}
}

// inbox is the events of a session come in and not yet applied. Those
// that come while the main thread is busy are applied in one update, so
// the history read when a session opens takes a frame or a few, not one
// for each event.
type inbox struct {
	mu     sync.Mutex
	events []agent.Event
}

// put adds e, and is whether it is the first since the last take: the one
// to ask for an update.
func (b *inbox) put(e agent.Event) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.events = append(b.events, e)
	return len(b.events) == 1
}

func (b *inbox) take() []agent.Event {
	b.mu.Lock()
	defer b.mu.Unlock()
	events := b.events
	b.events = nil
	return events
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
	a.request(func(ctx context.Context) {
		err := action(ctx)
		a.update(func() {
			if err != nil {
				a.failure = err.Error()
			}
		})
	})
}

// request runs work off the main thread, given as long as the service is
// waited for.
func (a *App) request(work func(ctx context.Context)) {
	a.async(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		work(ctx)
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
