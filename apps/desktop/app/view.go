package app

// The window: the sessions in a sidebar, by folder, what each is doing
// beside it; the chosen session to the right, with its conversation, the
// questions it waits on and the input. It is drawn as shadcn/ui draws
// (package shadcn).

import (
	"path/filepath"

	"github.com/egoist/mygo/ui"

	"desktop/agent"
	"desktop/conversation"
	"desktop/ui/components"
	"desktop/ui/icons"
)

// TitleBarHeight is how tall the window's title bar is, which the view
// draws under the window controls: the sidebar's top, and the session's
// header beside it.
const TitleBarHeight = 52

// View builds the window from the app's state.
func (a *App) View(c *ui.Context) {
	a.applyTheme(c)
	a.sliding = false
	defer a.saveSettings()

	if a.toast != nil {
		shown := a.toast
		a.toast = nil
		c.ToastAction(shown.message, shown.action, shown.run)
	}

	if a.vibrant(c) {
		c.Root().Background(ui.Transparent)
	}
	toasts(c, a.Layout.Sidebar)

	p := components.PaletteOf(a.theme)
	ui.Split(c, &a.Layout.Sidebar, func() { a.sidebar(c) }, func() {
		ui.Column(c).Fill().Background(p.Background).Children(func() {
			if a.settingsOpen {
				a.settings(c)
				return
			}
			s, view, ok := a.current()
			if !ok {
				ui.Box(c).Height(TitleBarHeight).Shrink(0).DragWindow()
				a.noSession(c)
				return
			}
			a.detail(c, s, view)
		})
	}).Fill()
}

// applyTheme sets the theme the settings choose, made again only when the
// mode, the scheme or the system's size of text changes.
func (a *App) applyTheme(c *ui.Context) {
	system := c.Theme()
	a.systemDark = system.Dark

	if a.Settings.Appearance == "" {
		a.Settings.Appearance = components.System
	}
	scheme := components.SchemeNamed(a.Settings.Theme)
	a.Settings.Theme = scheme.Name

	dark := a.Settings.Appearance.IsDark(system.Dark)
	if a.theme == nil || a.theme.Dark != dark || a.theme.FontSize != system.FontSize || a.scheme != scheme {
		a.theme, a.scheme = components.Theme(system, scheme, dark), scheme
	}

	components.Use(scheme)
	c.SetTheme(a.theme)
}

// SchemesChanged shows the schemes as their stylesheets were read again,
// or what is wrong with one, which leaves the schemes as they were.
func (a *App) SchemesChanged(schemes []*components.Scheme, err error) {
	if err != nil {
		a.toast = &toast{message: "Could not read the color schemes: " + err.Error()}
		return
	}
	components.Schemes = schemes
}

// vibrant is whether the window shows the system's material, light or
// dark as the app's appearance is (main sets it from the settings): not in
// the frame a change of the settings is drawn in, before it follows.
func (a *App) vibrant(c *ui.Context) bool {
	return c.Vibrancy() && a.theme.Dark == a.systemDark
}

// noSession fills the right side while no session is chosen: connecting,
// none yet, or every one archived.
func (a *App) noSession(c *ui.Context) {
	t := c.Theme()
	p := components.PaletteOf(t)
	ui.Column(c).Fill().Center().Gap(24).Padding(48).Children(func() {
		if !a.listed {
			ui.Column(c).MaxWidth(384).Gap(8).AlignItems(ui.Center).Children(func() {
				if a.link.problem != "" {
					ui.Text(c, a.link.problem).TextColor(p.Destructive).TextAlign(ui.Center)
					ui.Text(c, "Trying again…").TextColor(p.MutedForeground)
					return
				}
				components.Spinner(c, "Connecting", 16, ui.Color{})
				ui.Text(c, "Connecting to the agent…").TextColor(p.MutedForeground)
			})
			return
		}

		title := "Start with a project"
		if len(a.list.Sessions) > 0 {
			title = "No session chosen"
		}
		components.EmptyHeader(c, icons.FolderOpen, title, "A session works in one folder: it reads, edits and runs commands there, and asks before it does.")
		ui.Row(c).Gap(8).Children(func() {
			if a.list.DefaultRoot != "" && components.Button(c, "New Session in "+filepath.Base(a.list.DefaultRoot), components.ButtonStyle{}).
				Tooltip(a.list.DefaultRoot).Clicked() {
				a.NewSession(a.list.DefaultRoot)
			}
			if a.ChooseFolder != nil && components.Button(c, "Choose Folder…", components.ButtonStyle{Variant: components.Outline}).Clicked() {
				a.NewSessionInFolder()
			}
		})
		if a.failure != "" {
			ui.Text(c, a.failure).TextColor(p.Destructive).FontSize(components.TextXS(t))
		}
	})
}

func (a *App) detail(c *ui.Context, s agent.Session, view *sessionView) {
	view.answer.reset(view.t.Asking)
	room := ui.Row(c).Grow(1).MinHeight(0).AlignItems(ui.Stretch)
	space := room.Bounds().W
	room.Children(func() {
		// It gives the inspector room smoothly, but keeps up with its edge
		// while dragged
		conv := a.conversation(c, s, view)
		if !a.resizing {
			conv.Transition(ui.ElementTransition{Duration: panelMotion.Duration, Ease: panelMotion.Ease, Size: true})
		}

		// The step shown is read once its lines in the conversation, which
		// a click shows or hides, are built
		step := view.t.Inspected
		if step == nil {
			return
		}
		// With too little room for both, the inspector covers the
		// conversation rather than squeeze it
		covering := space < inspectorMin+conversationMin
		width := min(a.Layout.Inspector, max(space-conversationMin, inspectorMin))
		a.inspector(c, view, step, covering, width)
	})
}

// conversation is the session's conversation, which scrolls under the
// header, which frosts it, and under the input, of frosted glass, at its
// end.
func (a *App) conversation(c *ui.Context, s agent.Session, view *sessionView) ui.Element {
	return ui.Box(c.Key("room:" + s.ID)).Grow(1).MinWidth(0).Children(func() {
		conversation.View(c.Key("conversation:"+s.ID), &view.list, &view.t).Fill().
			Padding(TitleBarHeight+24, 24, view.bottom+24).ScrollbarInsets(TitleBarHeight, 0, view.bottom)
		a.header(c, s, view)
		bottom := ui.Column(c).Absolute().Bottom(0).Left(0).Right(0).PassThrough().Children(func() {
			if view.t.Asking != nil && !s.Archived {
				a.questions(c.Key("questions:"+s.ID), view)
			}
			a.composer(c.Key("composer:"+s.ID), s, view)
		})
		// Known only once laid out: the conversation makes room for it a
		// frame later
		if h := bottom.Bounds().H; h != view.bottom {
			view.bottom = h
			c.AnimationFrame()
		}
	})
}
