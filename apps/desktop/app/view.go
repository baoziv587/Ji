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
	if system := c.Theme(); a.theme == nil || a.theme.Dark != system.Dark || a.theme.FontSize != system.FontSize {
		a.theme = components.Theme(system)
	}
	c.SetTheme(a.theme)
	p := components.PaletteOf(a.theme)
	if a.toast != nil {
		shown := a.toast
		a.toast = nil
		c.ToastAction(shown.message, shown.action, shown.run)
	}

	if c.Vibrancy() {
		c.Root().Background(ui.Transparent)
	}
	toasts(c, a.SidebarSize)
	ui.Split(c, &a.SidebarSize, func() { a.sidebar(c) }, func() {
		ui.Column(c).Fill().Background(p.Background).Children(func() {
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

// noSession fills the right side while no session is chosen: connecting,
// none yet, or every one archived.
func (a *App) noSession(c *ui.Context) {
	t := c.Theme()
	p := components.PaletteOf(t)
	ui.Column(c).Fill().Center().Gap(24).Padding(48).Children(func() {
		if !a.listed {
			ui.Column(c).MaxWidth(384).Gap(8).AlignItems(ui.Center).Children(func() {
				if a.connection != "" {
					ui.Text(c, a.connection).TextColor(p.Destructive).TextAlign(ui.Center)
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
	view.startAnswering()
	// The conversation scrolls under the header, which frosts it, and under
	// the input, of frosted glass, at its end
	ui.Box(c).Grow(1).MinHeight(0).Children(func() {
		conversation.View(c.Key("conversation:"+s.ID), &view.list, &view.t).Fill().
			Padding(TitleBarHeight+24, 24, view.bottom+24).ScrollbarInsets(TitleBarHeight, 0, view.bottom)
		a.header(c, s, view)
		bottom := ui.Column(c).Absolute().Bottom(0).Left(0).Right(0).PassThrough().Children(func() {
			if view.t.Asking != nil && !s.Archived {
				a.questions(c.Key("questions:"+s.ID), s.ID, view)
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
