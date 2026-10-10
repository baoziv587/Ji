package agentui

// The window: the sessions in a sidebar, by folder, what each is doing
// beside it; the chosen session to the right, with its conversation, the
// questions it waits on and the input. It is drawn as shadcn/ui draws:
// its palette (theme.go) and its controls (components.go).

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/egoist/mygo/ui"
)

// conversationWidth is how wide the conversation, its questions and the
// input run at most, centered: max-w-3xl.
const conversationWidth = 768

// View builds the window from the app's state.
func (a *App) View(c *ui.Context) {
	if system := c.Theme(); a.theme == nil || a.theme.Dark != system.Dark || a.theme.FontSize != system.FontSize {
		a.theme = themeFrom(system)
	}
	c.SetTheme(a.theme)
	p := paletteOf(a.theme)
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

func (a *App) sidebar(c *ui.Context) {
	t := c.Theme()
	p := paletteOf(t)
	ui.Column(c).Fill().Background(p.Sidebar).BorderWidth(0, 1, 0, 0).BorderColor(p.SidebarBorder).Children(func() {
		// Lined up with the items' text, the sidebar's padding and theirs
		ui.Row(c).Height(48).Padding(0, 10, 0, 18).Gap(8).AlignItems(ui.Center).Children(func() {
			dot := p.Destructive
			if a.connected {
				dot = t.Success
			}
			ui.Box(c).Size(6, 6).Radius(3).Background(dot).Label("Connection").
				Tooltip(map[bool]string{true: "Connected to the agent", false: "Not connected to the agent"}[a.connected])
			ui.Text(c, "Sessions").FontWeight(600).Grow(1)
			if button(c, "", buttonStyle{variant: variantGhost, size: sizeIconSmall, icon: plusIcon}).
				Label("New Session").Tooltip("New Session (⌘N)").Clicked() {
				a.NewSession("")
			}
		})

		groups, archived := a.groups()
		if ui.Sidebar(c, &a.selected, func() {
			for _, g := range groups {
				a.section(c, g)
			}
			if len(archived) > 0 {
				ui.SidebarSection(c, fmt.Sprintf("Archived (%d)", len(archived)), &a.archivedOpen, func() {
					for _, s := range archived {
						a.row(c, s)
					}
				})
			}
		}).Background(p.Sidebar).Grow(1).Changed() {
			a.open(a.selected)
		}

		if a.ChooseFolder != nil {
			ui.Row(c).Padding(8, 10, 10).Children(func() {
				if button(c, "Open Folder…", buttonStyle{variant: variantOutline, size: sizeSmall, icon: folderOpenIcon}).
					Tooltip("Start a session in another folder (⌘O)").Grow(1).Clicked() {
					a.NewSessionInFolder()
				}
			})
		}
	})
}

// group is a folder's sessions, most recent first.
type group struct {
	root, title string
	sessions    []Session
}

// groups puts the sessions not archived under their folders, the folder
// used last first, and the archived ones apart.
func (a *App) groups() ([]group, []Session) {
	var groups []group
	at := map[string]int{}
	var archived []Session
	for _, s := range a.list.Sessions {
		if s.Archived {
			archived = append(archived, s)
			continue
		}
		i, ok := at[s.Root]
		if !ok {
			i = len(groups)
			at[s.Root] = i
			groups = append(groups, group{root: s.Root, title: filepath.Base(s.Root)})
		}
		groups[i].sessions = append(groups[i].sessions, s)
	}
	// Two folders of one name tell themselves apart by their parents
	names := map[string]int{}
	for _, g := range groups {
		names[g.title]++
	}
	for i, g := range groups {
		if names[g.title] > 1 {
			groups[i].title = g.title + " · " + filepath.Base(filepath.Dir(g.root))
		}
	}
	return groups, archived
}

func (a *App) section(c *ui.Context, g group) {
	open := a.opened[g.root]
	if open == nil {
		open = new(bool)
		*open = true
		a.opened[g.root] = open
	}
	ui.SidebarSection(c.Key("section:"+g.root), g.title, open, func() {
		for _, s := range g.sessions {
			a.row(c, s)
		}
	}).Tooltip(g.root)
}

func (a *App) row(c *ui.Context, s Session) {
	t := c.Theme()
	p := paletteOf(t)
	status := a.status(s)
	item := ui.SidebarItem(c.Key(s.ID), s.ID, nil, titleOf(s)).Height(32).Padding(0, 8).Transition(colorTransition)
	if s.ID == a.selected {
		// The active item, focused or not: bg-sidebar-accent font-medium
		item.Background(p.SidebarAccent).TextColor(p.Foreground).FontWeight(500)
	}
	item.Children(func() {
		switch status {
		case "asking":
			badge(c, "Approval", variantDefault)
		case "running":
			spinner(c, "Running")
		case "failed":
			badge(c, "Failed", variantDestructive)
		default:
			ui.Text(c, ago(s.Updated, time.Now())).FontSize(textXS(t)).FontWeight(500).TextColor(p.MutedForeground).FontFeatures("tnum")
		}
	})
	item.ContextMenu(func(m *ui.Menu) {
		if m.Item("New Session in This Folder").Chosen() {
			a.NewSession(s.Root)
		}
		m.Separator()
		if s.Archived {
			if m.Item("Unarchive").Chosen() {
				a.unarchive(s.ID)
			}
		} else if m.Item("Archive").Disabled(status == "running" || status == "asking").Chosen() {
			a.archive(s.ID, true)
		}
	})
}

// status is what a session is doing: the live state of one the window
// follows, the list's otherwise.
func (a *App) status(s Session) string {
	view := a.views[s.ID]
	if view == nil || view.t.State.ID == "" {
		return s.Status
	}
	st := view.t.State
	switch {
	case len(st.Asking) > 0 || view.t.Asking != nil:
		return "asking"
	case st.Replying:
		return "running"
	case st.Outcome == "failed":
		return "failed"
	}
	return "idle"
}

// noSession fills the right side while no session is chosen: connecting,
// none yet, or every one archived.
func (a *App) noSession(c *ui.Context) {
	t := c.Theme()
	p := paletteOf(t)
	ui.Column(c).Fill().Center().Gap(24).Padding(48).Children(func() {
		if !a.listed {
			ui.Column(c).MaxWidth(384).Gap(8).AlignItems(ui.Center).Children(func() {
				if a.connection != "" {
					ui.Text(c, a.connection).TextColor(p.Destructive).TextAlign(ui.Center)
					ui.Text(c, "Trying again…").TextColor(p.MutedForeground)
					return
				}
				spinner(c, "Connecting")
				ui.Text(c, "Connecting to the agent…").TextColor(p.MutedForeground)
			})
			return
		}

		title := "Start with a project"
		if len(a.list.Sessions) > 0 {
			title = "No session chosen"
		}
		emptyHeader(c, folderOpenIcon, title, "A session works in one folder: it reads, edits and runs commands there, and asks before it does.")
		ui.Row(c).Gap(8).Children(func() {
			if a.list.DefaultRoot != "" && button(c, "New Session in "+filepath.Base(a.list.DefaultRoot), buttonStyle{}).
				Tooltip(a.list.DefaultRoot).Clicked() {
				a.NewSession(a.list.DefaultRoot)
			}
			if a.ChooseFolder != nil && button(c, "Choose Folder…", buttonStyle{variant: variantOutline}).Clicked() {
				a.NewSessionInFolder()
			}
		})
		if a.failure != "" {
			ui.Text(c, a.failure).TextColor(p.Destructive).FontSize(textXS(t))
		}
	})
}

func (a *App) detail(c *ui.Context, s Session, view *sessionView) {
	view.startAnswering()
	a.header(c, s, view)
	a.conversation(c.Key("conversation:"+s.ID), view)
	if view.t.Asking != nil && !s.Archived {
		a.questions(c.Key("questions:"+s.ID), s.ID, view)
	}
	a.composer(c.Key("composer:"+s.ID), s, view)
}

func (a *App) header(c *ui.Context, s Session, view *sessionView) {
	t := c.Theme()
	p := paletteOf(t)
	st := view.t.State
	ui.Row(c).Height(56).Gap(8).Padding(0, 16).AlignItems(ui.Center).BorderWidth(0, 0, 1, 0).BorderColor(p.Border).Children(func() {
		ui.Column(c).Grow(1).Shrink(1).Gap(2).Children(func() {
			ui.Text(c, titleOf(s)).FontWeight(600).SingleLine()
			ui.Text(c, shortPath(s.Root)).FontSize(textXS(t)).TextColor(p.MutedForeground).SingleLine().Tooltip(s.Root)
		})
		if st.Model != "" {
			badge(c, st.Model, variantOutline).Tooltip("Model")
		}
		if st.Fast {
			badge(c, "fast", variantSecondary).Tooltip("OpenAI's priority tier, at about 2x the usage: /fast off")
		}
		if len(st.ThinkingLevels) > 0 {
			level := st.Thinking
			if selectMenu(c, &level, st.ThinkingLevels, s.Archived).Label("Thinking").Tooltip("Thinking level").Changed() {
				a.think(s.ID, view, level)
			}
		}
		if s.Archived {
			if button(c, "Unarchive", buttonStyle{variant: variantOutline, size: sizeSmall, icon: archiveRestoreIcon}).Clicked() {
				a.unarchive(s.ID)
			}
			return
		}
		busy := st.Replying || len(st.Asking) > 0
		archive := button(c, "Archive", buttonStyle{variant: variantGhost, size: sizeSmall, icon: archiveIcon, disabled: busy})
		if busy {
			archive.Tooltip("Stop the reply before archiving the session")
		} else {
			archive.Tooltip("Move to Archived; nothing is deleted")
		}
		if archive.Clicked() {
			a.archive(s.ID, true)
		}
	})
}

// centered lays fn out in a column as wide as the conversation at most, in
// the middle of the room there is.
func centered(c *ui.Context, gap float32, fn func()) ui.Element {
	var column ui.Element
	ui.Row(c).Justify(ui.Center).Children(func() {
		column = ui.Column(c).Grow(1).MaxWidth(conversationWidth).Gap(gap).Children(fn)
	})
	return column
}

func (a *App) conversation(c *ui.Context, view *sessionView) {
	t := c.Theme()
	p := paletteOf(t)
	// Follows the end of the conversation, unless scrolled up from it
	if view.scroll.Y >= view.scroll.MaxY-4 {
		view.scroll.Y = math.MaxFloat32
	}
	ui.Scroll(c).TrackScroll(&view.scroll).Grow(1).Padding(24).Children(func() {
		centered(c, 16, func() {
			if view.t.State.ID == "" && len(view.t.Items) == 0 {
				marker(c, func() { spinner(c, "Opening") }, "Opening the session…")
				return
			}
			if len(view.t.Items) == 0 {
				ui.Column(c).Center().Gap(12).Padding(80, 0).Children(func() {
					ui.Text(c, "What should we work on?").FontSize(textLG(t)).FontWeight(500).LetterSpacing(-0.4)
					ui.Row(c).Gap(16).Children(func() {
						for _, hint := range [][2]string{{"↵", "to send"}, {"⇧ ↵", "for a new line"}, {"/", "for commands"}} {
							ui.Row(c).Gap(6).AlignItems(ui.Center).Children(func() {
								kbd(c, hint[0])
								ui.Text(c, hint[1]).FontSize(textXS(t)).TextColor(p.MutedForeground)
							})
						}
					})
				})
			}
			for i, item := range view.t.Items {
				a.item(c.Key(i), item)
			}
		})
	})
}

// marker is shadcn/ui's Marker: a note in the conversation that is no
// one's message, after an icon.
func marker(c *ui.Context, icon func(), text string) ui.Element {
	p := paletteOf(c.Theme())
	return ui.Row(c).Gap(8).AlignItems(ui.Start).Children(func() {
		icon()
		// MinWidth(0): a word longer than the row, a link say, breaks
		// rather than pushing the row past the window
		ui.Text(c, text).TextColor(p.MutedForeground).LineHeight(1.25).Selectable().Shrink(1).MinWidth(0)
	})
}

func (a *App) item(c *ui.Context, item *Item) {
	t := c.Theme()
	p := paletteOf(t)
	switch item.Kind {
	case KindUser:
		// A Bubble, secondary, at the end: rounded-xl px-3 py-2 leading-relaxed
		ui.Row(c).Justify(ui.End).Children(func() {
			ui.Column(c).MaxWidth(conversationWidth*0.8).Padding(8, 12).Radius(14).Background(p.Secondary).Gap(4).Children(func() {
				ui.Text(c, item.Text).Selectable().LineHeight(1.625)
				if item.Steer {
					ui.Text(c, "steer").FontSize(textXS(t)).FontWeight(500).TextColor(p.MutedForeground)
				}
			})
		})
	case KindText:
		ui.Text(c, strings.TrimSpace(item.Text)).Selectable().LineHeight(1.625)
	case KindThinking:
		ui.Collapsible(c, "Thinking", &item.Open, func() {
			ui.Text(c, strings.TrimSpace(item.Text)).TextColor(p.MutedForeground).LineHeight(1.625).Selectable()
		})
	case KindTool:
		a.tool(c, item)
	case KindNotice:
		icon, color, label := (*ui.SVG)(nil), p.MutedForeground, ""
		switch {
		case item.Failed:
			icon, color, label = xIcon, p.Destructive, "Failed"
		case item.Level == "warn":
			icon, color, label = triangleAlertIcon, t.Warning, "Warning"
		case item.Level == "success":
			icon, color, label = checkIcon, t.Success, "Done"
		case item.Level == "info":
			icon, label = infoIcon, "Note"
		}
		marker(c, func() {
			if icon != nil {
				ui.Icon(c, icon).FontSize(16).TextColor(color).Label(label)
			}
		}, item.Text)
	case KindHelp:
		help(c, item.Help)
	}
}

// tool is a call of a tool as shadcn/ui's Item, outlined and small: what
// it did beside how it went, its details folded under them.
func (a *App) tool(c *ui.Context, item *Item) {
	t := c.Theme()
	p := paletteOf(t)
	call := item.Tool
	ui.Column(c).Padding(10, 14).Radius(t.Radius).Border(1, p.Border).Gap(6).Children(func() {
		ui.Row(c).Gap(10).AlignItems(ui.Center).Children(func() {
			switch {
			case !call.Done:
				spinner(c, "Running")
			case call.OK:
				ui.Icon(c, checkIcon).FontSize(16).TextColor(t.Success).Label("Succeeded")
			default:
				ui.Icon(c, xIcon).FontSize(16).TextColor(p.Destructive).Label("Failed")
			}
			ui.Text(c, call.Name).FontWeight(500).Font("monospace")
			ui.Text(c, oneLine(call.Args)).TextColor(p.MutedForeground).Font("monospace").FontSize(textXS(t)).SingleLine().Grow(1).Shrink(1)
			if call.Done {
				ui.Text(c, duration(call.MS)).TextColor(p.MutedForeground).FontSize(textXS(t)).FontFeatures("tnum")
			}
		})
		ui.Collapsible(c, "Details", &item.Open, func() {
			ui.Column(c).Gap(8).Children(func() {
				code(c, func() { ui.Text(c, call.Args).Font("monospace").FontSize(textXS(t)).Selectable() })
				if call.Done {
					output := call.Output
					if output == "" {
						output = "(no output)"
					}
					code(c, func() {
						ui.Text(c, output).Font("monospace").FontSize(textXS(t)).TextColor(p.MutedForeground).Selectable()
					})
				}
			})
		})
	})
}

// code is a block of code: bg-muted rounded-md.
func code(c *ui.Context, fn func()) ui.Element {
	return ui.Column(c).Padding(8, 12).Radius(c.Theme().Radius).Background(paletteOf(c.Theme()).Muted).Children(fn)
}

// questions shows what the session waits on, as shadcn/ui's Card above the
// input: an approval answers with a click, the model's own questions with
// picks and a Send.
func (a *App) questions(c *ui.Context, id string, view *sessionView) {
	t := c.Theme()
	p := paletteOf(t)
	asking := view.t.Asking
	// A call waiting for a yes: one click answers it
	approval := asking.Tool != "" && len(asking.Questions) == 1 && !asking.Questions[0].Multiple && !asking.Questions[0].Other

	ui.Column(c).Padding(0, 24, 12).Children(func() {
		card := centered(c, 12, func() {
			for i, q := range asking.Questions {
				ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
					ui.Text(c, q.Title).FontWeight(600).Grow(1).Shrink(1)
					if asking.Outside && i == 0 {
						badge(c, "outside the folder", variantDestructive)
					}
				})
				if q.Detail != "" {
					ui.Scroll(c).MaxHeight(220).Padding(8, 12).Radius(t.Radius).Background(p.Muted).Children(func() {
						detail(c, q.Detail)
					})
				}
				ui.Row(c.Key(i)).Gap(8).Wrap().Children(func() {
					for _, o := range q.Options {
						style := buttonStyle{variant: variantOutline, size: sizeSmall}
						switch {
						case approval && o.Value == "yes":
							style.variant = variantDefault
						case !approval && view.picked(i, o.Value):
							// A toggle that is on
							style.variant, style.icon = variantSecondary, checkIcon
						}
						b := button(c, o.Label, style)
						if o.Hint != "" {
							b.Tooltip(o.Hint)
						}
						if b.Clicked() {
							if approval {
								a.answer(id, view, [][]string{{o.Value}})
							} else {
								view.toggle(i, o.Value, q.Multiple)
							}
						}
					}
				})
				if q.Other {
					placeholder := "Or type your own answer"
					switch {
					case q.Placeholder != "":
						placeholder = q.Placeholder
					case len(q.Options) == 0:
						placeholder = "Type your answer"
					}
					input := textInput(c.Key(fmt.Sprint("other", i)), &view.others[i]).Placeholder(placeholder).Label("Your answer")
					if q.Secret {
						input.Password()
					}
				}
			}
			// An approval's No says it all; the model's questions can be left unanswered
			if !approval {
				ui.Row(c).Gap(8).Justify(ui.End).Children(func() {
					if button(c, "Dismiss", buttonStyle{variant: variantGhost, size: sizeSmall}).
						Tooltip("Answer none of them: the agent asks what you want instead").Clicked() {
						a.answer(id, view, nil)
					}
					if button(c, "Send answer", buttonStyle{size: sizeSmall}).Clicked() {
						a.answer(id, view, view.answers())
					}
				})
			}
		})
		// rounded-xl border bg-card shadow-sm
		card.Padding(16).Radius(14).Border(1, p.Border).Background(p.Card).Shadow(0, 1, 3, 0, ui.RGBA(0, 0, 0, 0.1))
	})
}

// composer is where the next message is typed, between the terminal's two
// bars: above it the status line, what the reply does, the mode and the
// keys that work now; below it the usage. The input is shadcn/ui's
// InputGroup: the text area, and under it in the same border the buttons
// that send and stop. The menu of commands opens over the conversation as
// a `/` is typed.
func (a *App) composer(c *ui.Context, s Session, view *sessionView) {
	t := c.Theme()
	p := paletteOf(t)
	st := view.t.State
	ui.Column(c).Padding(0, 24, 12).Children(func() {
		centered(c, 6, func() {
			if s.Archived {
				ui.Row(c).Gap(12).AlignItems(ui.Center).Padding(12, 16).Radius(t.Radius).Border(1, p.Border).Children(func() {
					ui.Text(c, "This session is archived. Unarchive it to go on.").TextColor(p.MutedForeground).Grow(1)
					if button(c, "Unarchive", buttonStyle{variant: variantOutline, size: sizeSmall, icon: archiveRestoreIcon}).Clicked() {
						a.unarchive(s.ID)
					}
				})
				return
			}
			entries := view.menu.entries(st.Commands, view.draft)
			a.statusLine(c, s, view, entries)

			group := ui.Column(c).Radius(t.Radius).Border(1, p.Input).Shadow(0, 1, 2, 0, ui.RGBA(0, 0, 0, 0.05)).Transition(colorTransition)
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
				if view.menu.toEnd {
					view.menu.toEnd = false
					area.SetTextSelection(runeCount(view.draft), runeCount(view.draft))
				}
				ui.Row(c).Gap(8).AlignItems(ui.Center).Justify(ui.End).Padding(4, 12, 12).Children(func() {
					if st.Replying {
						if button(c, "Stop", buttonStyle{variant: variantOutline, size: sizeExtraSmall, icon: squareIcon}).Tooltip("Esc").Clicked() {
							a.stop(s.ID)
						}
					}
					label := "Send"
					if st.Replying {
						label = "Steer"
					}
					if button(c, "", buttonStyle{size: sizeIconExtraSmall, icon: arrowUpIcon, disabled: strings.TrimSpace(view.draft) == ""}).
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
				a.commandList(c, s, view, entries).Attach(ui.AnchorTopLeft, ui.AnchorBottomLeft).Top(-4)
			}
		})
	})
}

// composerKey is what a key does in the input before the text area has
// it: the menu's keys while it is open, then Enter sends and Shift+Tab
// switches the mode, as in the terminal.
func (a *App) composerKey(s Session, view *sessionView, ev ui.InputEvent) bool {
	if ev.Kind != ui.InputKeyDown {
		return false
	}
	if entries := view.menu.entries(view.t.State.Commands, view.draft); len(entries) > 0 {
		chosen := entries[view.menu.selected]
		switch {
		case ev.Key == ui.KeyUp && ev.Mods == 0:
			view.menu.move(-1, len(entries))
			return true
		case ev.Key == ui.KeyDown && ev.Mods == 0:
			view.menu.move(1, len(entries))
			return true
		case ev.Key == ui.KeyTab && ev.Mods == 0:
			view.menu.complete(&view.draft, chosen)
			return true
		case ev.Key == ui.KeyEscape:
			view.menu.close(view.draft)
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
func (a *App) choose(id string, view *sessionView, e menuEntry) {
	if e.runs() {
		a.command(id, view, e.completion())
		return
	}
	view.menu.complete(&view.draft, e)
}

func canSwitchMode(s Session, st State) bool {
	return st.Mode != "" && st.Mode != "yolo" && !s.Archived
}

// statusLine is the terminal's status line: what the reply does and for
// how long, the mode, what a yes allowed, the steers not yet delivered,
// which entry of the menu is chosen, then the keys that work now.
func (a *App) statusLine(c *ui.Context, s Session, view *sessionView, entries []menuEntry) {
	t := c.Theme()
	p := paletteOf(t)
	st := view.t.State
	small := func(text string, color ui.Color) ui.Element { return barText(c, text, color) }
	ui.Row(c).Height(20).Gap(6).Padding(0, 4).AlignItems(ui.Center).Children(func() {
		var parts []func()
		switch {
		case a.connection != "":
			parts = append(parts, func() { small(a.connection, p.Destructive).Shrink(1) })
		case a.failure != "":
			parts = append(parts, func() { small(a.failure, p.Destructive).Selectable().Shrink(1) })
		}
		if label := view.t.Activity; label != "" && (st.Replying || view.t.Asking != nil) {
			parts = append(parts, func() {
				ui.Row(c).Gap(6).AlignItems(ui.Center).Shrink(1).Children(func() {
					spinner(c, label).FontSize(12)
					small(label, p.Foreground).Shrink(1)
					small(fmt.Sprintf("%ds", int(time.Since(view.t.Since).Seconds())), p.MutedForeground)
				})
			})
		}
		if st.Mode != "" {
			parts = append(parts, func() {
				// Less careful than ask, so it stands out in the warning color
				color := p.MutedForeground
				if st.Mode != "ask" {
					color = t.Warning
				}
				mode := ui.ButtonBase(c).Padding(0, 4).Radius(4).FocusRing(false).Transition(colorTransition).Label("Mode")
				if !canSwitchMode(s, st) {
					mode.Disabled(true)
				} else if mode.Hovered() {
					mode.Background(p.Accent)
				}
				focusRing(mode, p, 0)
				mode.Children(func() { small(st.Mode, color).FontWeight(500) })
				switch st.Mode {
				case "ask":
					mode.Tooltip("Every command, file read and change waits for a yes. ⇧⇥ approves the folder's files.")
				case "auto":
					mode.Tooltip("Files inside the folder are approved; commands still wait for a yes. ⇧⇥ asks about all.")
				default:
					mode.Tooltip("Nothing waits for a yes, outside the folder too. Chosen when the service started.")
				}
				if mode.Clicked() {
					a.switchMode(s.ID, view)
				}
			})
		}
		if st.Allowed != "" {
			parts = append(parts, func() { small(st.Allowed, t.Warning).Shrink(1) })
		}
		if st.Queued > 0 {
			parts = append(parts, func() { small(fmt.Sprintf("%d queued", st.Queued), p.Info) })
		}
		if len(entries) > 0 {
			parts = append(parts, func() { small(fmt.Sprintf("%d of %d", view.menu.selected+1, len(entries)), p.MutedForeground) })
		}

		for i, part := range parts {
			if i > 0 {
				small("·", p.MutedForeground)
			}
			part()
		}

		ui.Box(c).Grow(1)
		for _, key := range keysOf(st, view, entries) {
			ui.Row(c).Gap(4).AlignItems(ui.Center).Shrink(0).Children(func() {
				kbd(c, key[0])
				small(key[1], p.MutedForeground)
			})
		}
	})
}

// keysOf is the keys that work now, as the terminal's status line lists
// them.
func keysOf(st State, view *sessionView, entries []menuEntry) [][2]string {
	switch {
	case len(entries) > 0:
		return [][2]string{{"↑↓", "choose"}, {"tab", "completes"}, {"↵", "runs"}, {"esc", "closes"}}
	case view.t.Asking != nil && st.Replying:
		return [][2]string{{"esc", "stops"}}
	case st.Replying:
		return [][2]string{{"↵", "steers"}, {"esc", "stops"}}
	case st.Mode != "" && st.Mode != "yolo":
		return [][2]string{{"⇧⇥", "switches"}, {"/", "commands"}}
	default:
		return [][2]string{{"/", "commands"}}
	}
}

// usageLine is the terminal's usage line: the history's size against
// where it is compacted, then what the session has spent. Blank until the
// first call has ended.
func usageLine(c *ui.Context, u UsageReading) {
	t := c.Theme()
	p := paletteOf(t)
	ui.Row(c).Height(16).Gap(12).Padding(0, 4).AlignItems(ui.Center).Children(func() {
		if u.Calls == 0 {
			return
		}

		if ctx := u.Context; ctx != nil {
			estimate, color := "", p.MutedForeground
			if ctx.Estimated {
				estimate = "~"
			}
			switch {
			case float64(ctx.Tokens) >= float64(ctx.Limit)*0.9:
				color = p.Destructive
			case float64(ctx.Tokens) >= float64(ctx.Limit)*0.7:
				color = t.Warning
			}
			barText(c, fmt.Sprintf("ctx %s%s/%s", estimate, count(ctx.Tokens), count(ctx.Limit)), color).
				Tooltip("The history, against where it is compacted")
		}

		parts := []string{
			fmt.Sprintf("$%.4f", u.Cost),
			fmt.Sprintf("in %s · out %s", count(u.Input), count(u.Output)),
			fmt.Sprintf("cache %d%%", u.Cache),
		}
		if u.Speed > 0 {
			parts = append(parts, fmt.Sprintf("%.0f tok/s", u.Speed))
		}
		barText(c, strings.Join(parts, " · "), p.MutedForeground).Shrink(1)
	})
}

// barText is the small text of the status and usage lines, its digits
// tabular so a count that changes does not jiggle what follows it.
func barText(c *ui.Context, text string, color ui.Color) ui.Element {
	return ui.Text(c, text).FontSize(textXS(c.Theme())).TextColor(color).FontFeatures("tnum").SingleLine()
}

// commandList is shadcn/ui's Command in a popover: the commands that match
// what is typed, or what the command takes, the chosen one in the accent;
// a click runs it as Enter does.
func (a *App) commandList(c *ui.Context, s Session, view *sessionView, entries []menuEntry) ui.Element {
	t := c.Theme()
	p := paletteOf(t)
	panel := ui.Column(c).WidthPercent(100).Padding(4).Radius(t.Radius).Background(p.Popover).Border(1, p.Border).
		Shadow(0, 4, 6, -1, ui.RGBA(0, 0, 0, 0.1)).Label("Commands")
	panel.Children(func() {
		ui.Scroll(c).MaxHeight(8*32 + 24).Children(func() {
			group := ""
			for i, e := range entries {
				if e.Choice == "" && e.Command.Group != group {
					group = e.Command.Group
					ui.Text(c, group).FontSize(textXS(t)).FontWeight(500).TextColor(p.MutedForeground).Padding(6, 8)
				}
				// A row, not a button: the focus stays in the input, whose keys move along the menu
				item := ui.Row(c.Key(e.Command.Name+" "+e.Choice)).Height(32).Padding(0, 8).Gap(8).Radius(6).
					AlignItems(ui.Center).Label(e.completion())
				if item.Hovered() && view.menu.selected != i {
					view.menu.selected = i
				}
				if i == view.menu.selected {
					item.Background(p.Accent).ScrollIntoView()
				}
				item.Children(func() { menuRow(c, e, view.t.State) })
				if item.Clicked() {
					a.choose(s.ID, view, e)
				}
			}
		})
	})
	return panel
}

// menuRow is an entry's name, what it takes and what it does, with what
// was typed in the foreground and the rest muted; or a choice, a check by
// the one in use.
func menuRow(c *ui.Context, e menuEntry, st State) {
	t := c.Theme()
	p := paletteOf(t)
	if e.Choice != "" {
		marked(c, e.Choice, e.Chose, p.Foreground, p.Foreground).Grow(1)
		if inUse(e, st) {
			ui.Icon(c, checkIcon).FontSize(16).TextColor(p.Foreground).Label("In use")
		}
		return
	}
	// The name whole, as it is what is typed; what it takes and does give way
	marked(c, e.Command.Name, e.Name, p.Foreground, p.Foreground).FontWeight(500).Shrink(0)
	if e.Command.Arg != "" {
		ui.Text(c, e.Command.Arg).Font("monospace").FontSize(textXS(t)).TextColor(p.MutedForeground).SingleLine().Shrink(1)
	}
	ui.Box(c).Grow(1).MinWidth(12)
	marked(c, e.Command.Hint, e.Hint, p.MutedForeground, p.Foreground).FontSize(textXS(t)).Shrink(1)
}

// inUse says whether a choice is what the session uses now.
func inUse(e menuEntry, st State) bool {
	switch e.Command.Name {
	case "/think":
		return e.Choice == st.Thinking
	case "/fast":
		return (e.Choice == "on") == st.Fast
	}
	return false
}

// marked is text with the part that matched what is typed underlined in
// its own color, as the terminal underlines it.
func marked(c *ui.Context, text string, at span, color, match ui.Color) ui.Element {
	if at.From < 0 || at.To <= at.From {
		return ui.Text(c, text).TextColor(color).SingleLine()
	}
	return ui.RichText(c,
		ui.Span{Text: text[:at.From], Color: color},
		ui.Span{Text: text[at.From:at.To], Color: match, Underline: true},
		ui.Span{Text: text[at.To:], Color: color},
	).SingleLine()
}

// help is what /help lists, then the window's own keys, in a box of its
// own: each part's title small and muted, its rows a key and what it does.
func help(c *ui.Context, sections []HelpSection) {
	t := c.Theme()
	p := paletteOf(t)
	keys := HelpSection{Title: "Keys", Rows: [][2]string{
		{"↵", "sends, or steers a reply"}, {"⇧ ↵", "a new line"}, {"esc", "stops a reply"},
		{"⇧ ⇥", "switches ask/auto"}, {"/", "opens the commands"},
	}}
	ui.Column(c).Padding(12, 14).Radius(t.Radius).Border(1, p.Border).Gap(12).Children(func() {
		for i, section := range append(append([]HelpSection{}, sections...), keys) {
			ui.Column(c.Key(i)).Gap(4).Children(func() {
				ui.Text(c, section.Title).FontSize(textXS(t)).FontWeight(500).TextColor(p.MutedForeground)
				if section.Text != "" {
					ui.Text(c, section.Text).LineHeight(1.625).Selectable()
				}
				for _, row := range section.Rows {
					ui.Row(c).Gap(12).AlignItems(ui.Center).Children(func() {
						ui.Row(c).Width(120).Shrink(0).Gap(4).Children(func() {
							if len(row[0]) > 1 && strings.HasPrefix(row[0], "/") {
								ui.Text(c, row[0]).Font("monospace").FontWeight(500).SingleLine()
								return
							}
							// The window's keys, as keys
							for _, key := range strings.Fields(row[0]) {
								kbd(c, key)
							}
						})
						ui.Text(c, row[1]).TextColor(p.MutedForeground).Selectable().Shrink(1)
					})
				}
			})
		}
	})
}

// toasts shows the window's toasts as Sonner's, which shadcn/ui's are: at
// the bottom left, over the sidebar's empty end and no wider than it,
// clear of the input where the person types.
func toasts(c *ui.Context, width float32) {
	t := c.Theme()
	p := paletteOf(t)
	ui.ToastViewportBase(c, func(viewport ui.Element, shown []ui.Toast) {
		viewport.Padding(12, 12, 60, 12).AlignItems(ui.Start).Gap(8)
		for _, item := range shown {
			toast := ui.ToastBase(c, item)
			toast.Root.Row().AlignSelf(ui.Start).AlignItems(ui.Center).Gap(12).Padding(12, 12, 12, 16).Radius(10).
				MaxWidth(max(width-24, 160)).Background(p.Popover).Border(1, p.Border).Shadow(0, 4, 12, 0, ui.RGBA(0, 0, 0, 0.1))
			toast.Root.Transition(ui.ElementTransition{Enter: &ui.Motion{Y: 8}, Exit: &ui.Motion{}})
			toast.Root.Children(func() {
				ui.Text(c, item.Title).FontWeight(500).TextColor(p.Foreground).Shrink(1).MaxLines(2)
				if item.Action != "" {
					toast.ActionButton().Height(24).Padding(0, 8).Radius(4).Background(p.Primary).Children(func() {
						ui.Text(c, item.Action).FontSize(textXS(t)).FontWeight(500).TextColor(p.PrimaryForeground)
					})
				}
			})
		}
	})
}

// shortPath shows a folder by what tells it apart, its end: the home folder
// as ~, and a long path cut at its start.
func shortPath(path string) string {
	if home, err := os.UserHomeDir(); err == nil && home != "" && strings.HasPrefix(path, home) {
		path = "~" + strings.TrimPrefix(path, home)
	}
	const most = 48
	if len(path) <= most {
		return path
	}
	parts := strings.Split(path, string(filepath.Separator))
	shown := parts[len(parts)-1]
	for i := len(parts) - 2; i >= 0 && len(shown)+len(parts[i])+3 <= most; i-- {
		shown = parts[i] + string(filepath.Separator) + shown
	}
	return "…" + string(filepath.Separator) + shown
}

// detail shows a command or a diff, its added and removed lines in color.
func detail(c *ui.Context, text string) {
	t := c.Theme()
	ui.Column(c).Selectable().Children(func() {
		for _, line := range strings.Split(text, "\n") {
			color := t.Text
			switch {
			case strings.HasPrefix(line, "+++"), strings.HasPrefix(line, "---"), strings.HasPrefix(line, "@@"):
				color = t.TextMuted
			case strings.HasPrefix(line, "+"):
				color = t.Success
			case strings.HasPrefix(line, "-"):
				color = t.Danger
			}
			ui.Text(c, line).Font("monospace").FontSize(12).TextColor(color).NoWrap()
		}
	})
}

func status(s State) string {
	var parts []string
	if s.Queued > 0 {
		parts = append(parts, fmt.Sprintf("%d queued", s.Queued))
	}
	if s.Allowed != "" {
		parts = append(parts, s.Allowed)
	}
	if len(s.Tools) > 0 {
		parts = append(parts, fmt.Sprintf("%d tools", len(s.Tools)))
	}
	return strings.Join(parts, " · ")
}

// titleOf is a session's title, or what stands for one before its first
// message.
func titleOf(s Session) string {
	if s.Title == "" {
		return "New Session"
	}
	return s.Title
}

// ago says how long ago a time in milliseconds was, as briefly as a
// sidebar has room for.
func ago(ms int64, now time.Time) string {
	d := now.Sub(time.UnixMilli(ms))
	switch {
	case d < time.Minute:
		return "now"
	case d < time.Hour:
		return fmt.Sprintf("%dm", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%dh", int(d.Hours()))
	case d < 7*24*time.Hour:
		return fmt.Sprintf("%dd", int(d.Hours()/24))
	}
	return time.UnixMilli(ms).Format("Jan 2")
}

func oneLine(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

func duration(ms int) string {
	if ms < 1000 {
		return fmt.Sprintf("%dms", ms)
	}
	return fmt.Sprintf("%.1fs", float64(ms)/1000)
}
