package app

import (
	"strings"
	"unicode/utf8"

	"github.com/egoist/mygo/ui"

	"desktop/agent"
	"desktop/commands"
	"desktop/conversation"
	"desktop/ui/components"
	"desktop/ui/icons"
)

// composer is where the next message is typed, between the terminal's two
// bars: above it the status line, what the reply does, the mode and the
// keys that work now; below it the usage. The input is shadcn/ui's
// InputGroup: the text area, and under it in the same border the buttons
// that send and stop. The menu of commands opens over the conversation as
// a `/` is typed.
func (a *App) composer(c *ui.Context, s agent.Session, view *sessionView) {
	t := c.Theme()
	p := components.PaletteOf(t)
	st := view.t.State
	ui.Column(c).Padding(0, 24, 12).Children(func() {
		conversation.Centered(c, 6, func() {
			if s.Archived {
				ui.Row(c).Gap(12).AlignItems(ui.Center).Padding(12, 16).Radius(t.Radius).Border(1, p.Border).Children(func() {
					ui.Text(c, "This session is archived. Unarchive it to go on.").TextColor(p.MutedForeground).Grow(1)
					if components.Button(c, "Unarchive", components.ButtonStyle{Variant: components.Outline, Size: components.SizeSmall, Icon: icons.ArchiveRestore}).Clicked() {
						a.unarchive(s.ID)
					}
				})
				return
			}
			entries := view.menu.Entries(st.Commands, view.draft)
			a.statusLine(c, s, view, entries)

			group := ui.Column(c).Radius(t.Radius).Border(1, p.Input).Shadow(0, 1, 2, 0, ui.RGBA(0, 0, 0, 0.05)).Transition(components.ColorTransition)
			if t.Dark {
				group.Background(p.Input.Alpha(0.3))
			}
			group.Children(func() {
				placeholder := "Ask anything, or type / for commands"
				if st.Replying {
					placeholder = "Steer the reply: it reads this after the step in progress"
				}
				// The menu's keys, Enter and Shift+Tab, before the text area takes them; Shift+Enter is left to it
				area := ui.TextAreaBase(c.Key("draft"), &view.draft).Lines(2, 8).Placeholder(placeholder).Label("Message").AutoFocus().Padding(12, 12, 4).
					HandleInput(func(ev ui.InputEvent) bool { return a.composerKey(s, view, ev) })
				if view.menu.ToEnd {
					view.menu.ToEnd = false
					area.SetTextSelection(runeCount(view.draft), runeCount(view.draft))
				}
				ui.Row(c).Gap(8).AlignItems(ui.Center).Justify(ui.End).Padding(4, 12, 12).Children(func() {
					if st.Replying {
						if components.Button(c, "Stop", components.ButtonStyle{Variant: components.Outline, Size: components.SizeExtraSmall, Icon: icons.Square}).Tooltip("Esc").Clicked() {
							a.stop(s.ID)
						}
					}
					label := "Send"
					if st.Replying {
						label = "Steer"
					}
					if components.Button(c, "", components.ButtonStyle{Size: components.SizeIconExtraSmall, Icon: icons.ArrowUp, Disabled: strings.TrimSpace(view.draft) == ""}).
						Radius(999).Label(label).Tooltip(label + " (↵)").Clicked() {
						a.send(s.ID, view)
					}
				})
			})
			if group.FocusWithin() {
				group.Border(1, p.Ring).Shadow(0, 0, 0, 3, p.Ring.Alpha(0.5))
			}

			// Esc closes the menu first
			if st.Replying && len(entries) == 0 && c.Shortcut(0, ui.KeyEscape) {
				a.stop(s.ID)
			}
			usageLine(c, st.Usage)
			// Over the conversation, as wide as the input
			if len(entries) > 0 {
				commands.List(c, entries, &view.menu, view.t.State, func(e commands.Entry) { a.choose(s.ID, view, e) }).Attach(ui.AnchorTopLeft, ui.AnchorBottomLeft).Top(-4)
			}
		})
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
			a.choose(s.ID, view, chosen)
			return true
		}
	}

	switch {
	case ev.Key == ui.KeyEnter && ev.Mods == 0:
		a.send(s.ID, view)
		return true
	case ev.Key == ui.KeyTab && ev.Mods == ui.Shift:
		if canSwitchMode(s, view.t.State) {
			a.switchMode(s.ID, view)
		}
		return true
	}
	return false
}

// choose runs the entry, or completes it when it takes something next.
func (a *App) choose(id string, view *sessionView, e commands.Entry) {
	if e.Runs() {
		a.command(id, view, e.Completion())
		return
	}
	view.menu.Complete(&view.draft, e)
}

func canSwitchMode(s agent.Session, st agent.State) bool {
	return st.Mode != "" && st.Mode != "yolo" && !s.Archived
}

// runeCount is where the end of s is, as a text input counts.
func runeCount(s string) int { return utf8.RuneCountInString(s) }
