package app

import (
	"path/filepath"
	"unicode/utf8"

	"github.com/egoist/mygo/plugins/glass"
	"github.com/egoist/mygo/ui"

	"desktop/agent"
	"desktop/commands"
	"desktop/conversation"
	"desktop/format"
	"desktop/ui/components"
	"desktop/ui/icons"
)

// composer is where the next message is typed, under the terminal's status
// line, shown while the reply works, the menu is open or something went
// wrong. The two share one pane of glass, the files attached over the text
// area, the gauge of the usage and the buttons that attach, send and stop
// under it. The menu of commands opens over the conversation as a `/` is
// typed. The session's folder, branch and mode are under the pane.
func (a *App) composer(c *ui.Context, s agent.Session, view *sessionView, empty bool) {
	t := c.Theme()
	p := components.PaletteOf(t)
	st := view.t.State
	ui.Column(c).Padding(0, 24, 12).Children(func() {
		conversation.Centered(c, 6, func() {
			if !s.Archived && a.isMissing(s.Root) {
				a.folderGone(c, s)
				return
			}
			if s.Archived {
				ui.Row(c).
					Gap(12).
					AlignItems(ui.Center).
					Padding(12, 16).
					Radius(t.Radius).
					Border(1, p.Border).
					Children(func() {
						ui.Text(c, "This session is settled. Reopen it to go on.").
							TextColor(p.MutedForeground).
							Grow(1)
						unarchive := components.ButtonStyle{
							Variant: components.Outline,
							Size:    components.SizeSmall,
							Icon:    icons.ArchiveRestore,
						}
						if components.Button(c, "Reopen", unarchive).Clicked() {
							a.unarchive(s.ID)
						}
					})
				return
			}
			entries := view.menu.Entries(st.Commands, view.draft)
			// One pane of frosted glass, untoned, the conversation blurred
			// through it: the status line, the input, the usage
			pane := ui.Column(c).
				Gap(4).
				Padding(12, 12, 8).
				Radius(16).
				Border(1, p.Input).
				Material(glass.Blur{Radius: 12}).
				Transition(components.ColorTransition)
			if empty {
				pane.Background(p.Card.Alpha(0.6))
			}
			pane.Children(func() {
				a.statusLine(c, view, entries)
				a.attachments(c, view)
				placeholder := "Ask anything, or type / for commands"
				switch {
				case view.dropping:
					placeholder = "Drop the files to attach them"
				case st.Replying:
					placeholder = "Steer the reply: it reads this after the step in progress"
				}
				// The menu's keys, Enter and Shift+Tab, before the text area takes
				// them; Shift+Enter is left to it
				area := ui.TextAreaBase(c.Key("draft"), &view.draft).
					Lines(2, 8).
					Placeholder(placeholder).
					Label("Message").
					AutoFocus().
					Padding(4, 4, 0).
					HandleInput(func(ev ui.InputEvent) bool { return a.composerKey(s, view, ev) })
				if view.refocus {
					view.refocus = false
					area.Focus()
				}
				if view.menu.ToEnd {
					view.menu.ToEnd = false
					area.SetTextSelection(runeCount(view.draft), runeCount(view.draft))
				}
				ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
					if a.ChooseFiles != nil {
						attach := components.ButtonStyle{
							Variant: components.Ghost,
							Size:    components.SizeIconExtraSmall,
							Icon:    icons.Paperclip,
						}
						if components.Button(c, "", attach).
							Label("Attach files").
							Tooltip("Attach files, or drop them here").
							Clicked() {
							a.chooseFiles(view)
						}
					}
					usageGauge(c, st.Usage, &view.usageOpen, &view.usageDrain)
					ui.Box(c).Grow(1)
					a.modelControls(c, s, view)
					if st.Replying {
						stop := components.ButtonStyle{
							Variant: components.Outline,
							Size:    components.SizeExtraSmall,
							Icon:    icons.Square,
						}
						if components.Button(c, "Stop", stop).
							Tooltip("Esc").
							Clicked() {
							a.stop(s.ID)
						}
					}
					label := "Send"
					if st.Replying {
						label = "Steer"
					}
					send := components.ButtonStyle{
						Size:     components.SizeIconExtraSmall,
						Icon:     icons.ArrowUp,
						Disabled: !view.sendable(),
					}
					if components.Button(c, "", send).
						Radius(999).
						Label(label).
						Tooltip(label + " (↵)").
						Clicked() {
						a.send(view)
					}
				})
			})
			if pane.FocusWithin() || view.dropping {
				pane.Border(1, p.Ring).Shadow(0, 0, 0, 3, p.Ring.Alpha(0.25))
			}
			a.composerMeta(c, s, view)

			// Esc closes the menu and the inspector first
			if st.Replying && len(entries) == 0 && view.t.Inspected == nil &&
				c.Shortcut(0, ui.KeyEscape) {
				a.stop(s.ID)
			}
			// Over the conversation, as wide as the input
			if len(entries) > 0 {
				choose := func(e commands.Entry) {
					a.choose(view, e)
				}
				commands.List(c, entries, &view.menu, view.t.State, choose).
					Attach(ui.AnchorTopLeft, ui.AnchorBottomLeft).
					Top(-4)
			}
		})
	})
}

// folderGone stands for the input of a session whose folder is not there
// any more: it goes on where its project is now, or the project is told
// where that is.
func (a *App) folderGone(c *ui.Context, s agent.Session) {
	t := c.Theme()
	p := components.PaletteOf(t)
	live := a.liveFolder(s.Root)
	ui.Row(c).
		Gap(12).
		AlignItems(ui.Center).
		Padding(12, 16).
		Radius(t.Radius).
		Border(1, p.Destructive.Alpha(0.45)).
		Background(p.Destructive.Alpha(0.06)).
		Children(func() {
			ui.Icon(c, icons.TriangleAlert).FontSize(16).TextColor(p.Destructive).Shrink(0)
			ui.Text(c, format.ShortPath(s.Root)+" no longer exists.").
				Grow(1).
				Shrink(1).
				MinWidth(0)
			// The primary action is going on where the project is now, when it can
			edit := ui.PrimaryButton
			if live != "" {
				edit = ui.Button
			}
			if edit(c, "Edit Project…").Shrink(0).Clicked() {
				a.EditProject(a.groupKeyOf(s.Root))
			}
			if live == "" {
				return
			}
			if ui.PrimaryButton(c, "Continue in "+filepath.Base(live)).
				Tooltip("Its sessions go on in " + live + ", their history kept").
				Shrink(0).
				Clicked() {
				a.moveFolders([]string{s.Root}, live)
			}
		})
}

// modelControls is the model and its thinking level, chosen for the
// replies to come, as one quiet phrase before the buttons.
func (a *App) modelControls(c *ui.Context, s agent.Session, view *sessionView) {
	p := components.PaletteOf(c.Theme())
	st := view.t.State
	ui.Row(c).Gap(2).AlignItems(ui.Center).Shrink(1).MinWidth(0).Children(func() {
		if st.Model != "" {
			a.modelSelect(c.Key("model"), s, view)
		}
		if len(st.ThinkingLevels) > 0 {
			level := st.Thinking
			if components.InlineSelect(c, &level, st.ThinkingLevels, s.Archived).
				Label("Thinking").
				Tooltip("Thinking level").
				Shrink(0).
				Changed() {
				a.think(view, level)
			}
		}
		if st.Fast {
			ui.Text(c, "fast").
				TextColor(p.MutedForeground).
				Padding(0, 4).
				Shrink(0).
				Tooltip("OpenAI's priority tier, at about 2x the usage: /fast off")
		}
	})
}

// composerMeta is where the session works, under the input: its folder,
// the branch checked out there and its mode.
func (a *App) composerMeta(c *ui.Context, s agent.Session, view *sessionView) {
	ui.Row(c).Height(20).Padding(0, 12).Gap(16).AlignItems(ui.Center).Children(func() {
		metaLine(c, icons.Folder, format.ShortPath(s.Root)).MinWidth(0).Shrink(1).Tooltip(s.Root)
		ui.Box(c).Grow(1)
		if branch := a.branches[s.Root]; branch != "" {
			metaLine(c, icons.GitBranch, branch).
				MinWidth(0).
				Shrink(0).
				Tooltip("The branch checked out in the folder")
		}
		if view.t.State.Mode != "" {
			a.modeButton(c, s, view)
		}
	})
}

// composerKey is what a key does in the input before the text area has
// it: the menu's keys while it is open, then Enter sends and Shift+Tab
// switches the mode, as in the terminal.
func (a *App) composerKey(s agent.Session, view *sessionView, ev ui.InputEvent) bool {
	if ev.Kind != ui.InputKeyDown {
		return false
	}
	if entries := view.menu.Entries(view.t.State.Commands, view.draft); len(entries) > 0 {
		chosen := entries[view.menu.Selected]
		switch {
		case ev.Key == ui.KeyUp && ev.Mods == 0:
			view.menu.Move(-1, len(entries))
			return true
		case ev.Key == ui.KeyDown && ev.Mods == 0:
			view.menu.Move(1, len(entries))
			return true
		case ev.Key == ui.KeyTab && ev.Mods == 0:
			view.menu.Complete(&view.draft, chosen)
			return true
		case ev.Key == ui.KeyEscape:
			view.menu.Close(view.draft)
			return true
		case ev.Key == ui.KeyEnter && ev.Mods == 0:
			a.choose(view, chosen)
			return true
		}
	}

	switch {
	case ev.Key == ui.KeyEnter && ev.Mods == 0:
		a.send(view)
		return true
	case ev.Key == ui.KeyTab && ev.Mods == ui.Shift:
		if canSwitchMode(s, view.t.State) {
			a.switchMode(view)
		}
		return true
	}
	return false
}

// choose runs the entry, or completes it when it takes something next.
func (a *App) choose(view *sessionView, e commands.Entry) {
	if e.Runs() {
		a.command(view, e.Completion())
		return
	}
	view.menu.Complete(&view.draft, e)
}

func canSwitchMode(s agent.Session, st agent.State) bool {
	return st.Mode != "" && !s.Archived
}

// runeCount is where the end of s is, as a text input counts.
func runeCount(s string) int { return utf8.RuneCountInString(s) }
