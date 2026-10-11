package agentui

// The window: the sessions in a sidebar, by folder, what each is doing
// beside it; the chosen session to the right, with its conversation, the
// questions it waits on and the input. It is drawn as shadcn/ui draws
// (package shadcn).

import (
	"path/filepath"

	"github.com/egoist/mygo/ui"

	"desktop/agentui/agent"
	"desktop/agentui/conversation"
	"desktop/agentui/icons"
	"desktop/agentui/shadcn"
)

// View builds the window from the app's state.
func (a *App) View(c *ui.Context) {
	if system := c.Theme(); a.theme == nil || a.theme.Dark != system.Dark || a.theme.FontSize != system.FontSize {
		a.theme = shadcn.Theme(system)
	}
	c.SetTheme(a.theme)
	p := shadcn.PaletteOf(a.theme)
	if a.toast != nil {
		shown := a.toast
		a.toast = nil
		c.ToastAction(shown.message, shown.action, shown.run)
	}

	toasts(c, a.SidebarSize)
	ui.Split(c, &a.SidebarSize, func() { a.sidebar(c) }, func() {
		ui.Column(c).Fill().Background(p.Background).Children(func() {
			s, view, ok := a.current()
			if !ok {
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
	p := shadcn.PaletteOf(t)
	ui.Column(c).Fill().Center().Gap(24).Padding(48).Children(func() {
		if !a.listed {
			ui.Column(c).MaxWidth(384).Gap(8).AlignItems(ui.Center).Children(func() {
				if a.connection != "" {
					ui.Text(c, a.connection).TextColor(p.Destructive).TextAlign(ui.Center)
					ui.Text(c, "Trying again…").TextColor(p.MutedForeground)
					return
				}
				shadcn.Spinner(c, "Connecting")
				ui.Text(c, "Connecting to the agent…").TextColor(p.MutedForeground)
			})
			return
		}

		title := "Start with a project"
		if len(a.list.Sessions) > 0 {
			title = "No session chosen"
		}
		shadcn.EmptyHeader(c, icons.FolderOpen, title, "A session works in one folder: it reads, edits and runs commands there, and asks before it does.")
		ui.Row(c).Gap(8).Children(func() {
			if a.list.DefaultRoot != "" && shadcn.Button(c, "New Session in "+filepath.Base(a.list.DefaultRoot), shadcn.ButtonStyle{}).
				Tooltip(a.list.DefaultRoot).Clicked() {
				a.NewSession(a.list.DefaultRoot)
			}
			if a.ChooseFolder != nil && shadcn.Button(c, "Choose Folder…", shadcn.ButtonStyle{Variant: shadcn.Outline}).Clicked() {
				a.NewSessionInFolder()
			}
		})
		if a.failure != "" {
			ui.Text(c, a.failure).TextColor(p.Destructive).FontSize(shadcn.TextXS(t))
		}
	})
}

func (a *App) detail(c *ui.Context, s agent.Session, view *sessionView) {
	view.startAnswering()
	a.header(c, s, view)
	conversation.View(c.Key("conversation:"+s.ID), &view.scroll, &view.t)
	if view.t.Asking != nil && !s.Archived {
		a.questions(c.Key("questions:"+s.ID), s.ID, view)
	}
	a.composer(c.Key("composer:"+s.ID), s, view)
}
