package commands

import (
	"github.com/egoist/mygo/ui"

	"desktop/agent"
	"desktop/ui/components"
	"desktop/ui/icons"
)

// List is shadcn/ui's Command in a popover: the commands that match what
// is typed, or what the command takes, the chosen one in the accent; a
// click runs it as Enter does.
func List(c *ui.Context, entries []Entry, m *State, st agent.State, choose func(Entry)) ui.Element {
	t := c.Theme()
	p := components.PaletteOf(t)
	panel := ui.Column(c).WidthPercent(100).Padding(4).Radius(t.Radius).Background(p.Popover).Border(1, p.Border).
		Shadow(0, 4, 6, -1, ui.RGBA(0, 0, 0, 0.1)).Label("Commands")
	panel.Children(func() {
		ui.Scroll(c).MaxHeight(8*32 + 24).Children(func() {
			group := ""
			for i, e := range entries {
				if e.Choice == "" && e.Command.Group != group {
					group = e.Command.Group
					ui.Text(c, group).FontSize(components.TextXS(t)).FontWeight(500).TextColor(p.MutedForeground).Padding(6, 8)
				}
				// A row, not a button: the focus stays in the input, whose keys move along the menu
				item := ui.Row(c.Key(e.Command.Name+" "+e.Choice)).Height(32).Padding(0, 8).Gap(8).Radius(6).
					AlignItems(ui.Center).Label(e.Completion())
				if item.Hovered() && m.Selected != i {
					m.Selected = i
				}
				if i == m.Selected {
					item.Background(p.Accent).ScrollIntoView()
				}
				item.Children(func() { row(c, e, st) })
				if item.Clicked() {
					choose(e)
				}
			}
		})
	})
	return panel
}

// row is an entry's name, what it takes and what it does, with what
// was typed in the foreground and the rest muted; or a choice, a check by
// the one in use.
func row(c *ui.Context, e Entry, st agent.State) {
	t := c.Theme()
	p := components.PaletteOf(t)
	if e.Choice != "" {
		marked(c, e.Choice, e.Chose, p.Foreground, p.Foreground).Grow(1)
		if inUse(e, st) {
			ui.Icon(c, icons.Check).FontSize(16).TextColor(p.Foreground).Label("In use")
		}
		return
	}
	// The name whole, as it is what is typed; what it takes and does give way
	marked(c, e.Command.Name, e.Name, p.Foreground, p.Foreground).FontWeight(500).Shrink(0)
	if e.Command.Arg != "" {
		ui.Text(c, e.Command.Arg).Font("monospace").FontSize(components.TextXS(t)).TextColor(p.MutedForeground).SingleLine().Shrink(1)
	}
	ui.Box(c).Grow(1).MinWidth(12)
	marked(c, e.Command.Hint, e.Hint, p.MutedForeground, p.Foreground).FontSize(components.TextXS(t)).Shrink(1)
}

// inUse says whether a choice is what the session uses now.
func inUse(e Entry, st agent.State) bool {
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
func marked(c *ui.Context, text string, at Span, color, match ui.Color) ui.Element {
	if at.From < 0 || at.To <= at.From {
		return ui.Text(c, text).TextColor(color).SingleLine()
	}
	return ui.RichText(c,
		ui.Span{Text: text[:at.From], Color: color},
		ui.Span{Text: text[at.From:at.To], Color: match, Underline: true},
		ui.Span{Text: text[at.To:], Color: color},
	).SingleLine()
}
