// Package conversation is a session's conversation: built from the
// service's events (logic.go), and drawn (view.go) as the messages, the
// reply's text and thinking, the calls of tools and the notices, in a
// column as wide as it reads well, in the middle of the window.
package conversation

import (
	"math"
	"strings"

	"github.com/egoist/mygo/ui"

	"desktop/ui/components"
	"desktop/ui/icons"
)

// Width is how wide the conversation, its questions and the input run at
// most, centered: max-w-3xl.
const Width = 768

// Centered lays fn out in a column as wide as the conversation at most, in
// the middle of the room there is.
func Centered(c *ui.Context, gap float32, fn func()) ui.Element {
	var column ui.Element
	ui.Row(c).Justify(ui.Center).Children(func() {
		column = ui.Column(c).Grow(1).MaxWidth(Width).Gap(gap).Children(fn)
	})
	return column
}

// View is the conversation, scrolled to its end as it grows unless
// scrolled up from it.
func View(c *ui.Context, scroll *ui.ScrollState, t *Transcript) {
	theme := c.Theme()
	p := components.PaletteOf(theme)
	if scroll.Y >= scroll.MaxY-4 {
		scroll.Y = math.MaxFloat32
	}
	ui.Scroll(c).TrackScroll(scroll).Grow(1).Padding(24).Children(func() {
		Centered(c, 16, func() {
			if t.State.ID == "" && len(t.Items) == 0 {
				Marker(c, func() { components.Spinner(c, "Opening") }, "Opening the session…")
				return
			}
			if len(t.Items) == 0 {
				ui.Column(c).Center().Gap(12).Padding(80, 0).Children(func() {
					ui.Text(c, "What should we work on?").FontSize(components.TextLG(theme)).FontWeight(500).LetterSpacing(-0.4)
					ui.Row(c).Gap(16).Children(func() {
						for _, hint := range [][2]string{{"↵", "to send"}, {"⇧↵", "for a new line"}, {"/", "for commands"}} {
							ui.Row(c).Gap(6).AlignItems(ui.Center).Children(func() {
								components.Kbd(c, hint[0])
								ui.Text(c, hint[1]).FontSize(components.TextXS(theme)).TextColor(p.MutedForeground)
							})
						}
					})
				})
			}
			for i, it := range t.Items {
				item(c.Key(i), it)
			}
		})
	})
}

// Marker is shadcn/ui's Marker: a note in the conversation that is no
// one's message, after an icon.
func Marker(c *ui.Context, icon func(), text string) ui.Element {
	p := components.PaletteOf(c.Theme())
	return ui.Row(c).Gap(8).AlignItems(ui.Start).Children(func() {
		icon()
		// MinWidth(0): a word longer than the row, a link say, breaks
		// rather than pushing the row past the window
		ui.Text(c, text).TextColor(p.MutedForeground).LineHeight(1.25).Selectable().Shrink(1).MinWidth(0)
	})
}

func item(c *ui.Context, item *Item) {
	t := c.Theme()
	p := components.PaletteOf(t)
	switch item.Kind {
	case KindUser:
		// A Bubble, secondary, at the end: rounded-xl px-3 py-2 leading-relaxed
		ui.Row(c).Justify(ui.End).Children(func() {
			ui.Column(c).MaxWidth(Width*0.8).Padding(8, 12).Radius(14).Background(p.Secondary).Gap(4).Children(func() {
				ui.Text(c, item.Text).Selectable().LineHeight(1.625)
				if item.Steer {
					ui.Text(c, "steer").FontSize(components.TextXS(t)).FontWeight(500).TextColor(p.MutedForeground)
				}
			})
		})
	case KindText:
		ui.Text(c, strings.TrimSpace(item.Text)).Selectable().LineHeight(1.625)
	case KindThinking:
		components.Disclosure(c, "Thinking", &item.Open, func() {
			// In by the chevron and its gap, 16 + 8, so it sits under the label
			ui.Text(c, strings.TrimSpace(item.Text)).Padding(0, 0, 0, 24).
				TextColor(p.MutedForeground).LineHeight(1.625).Selectable()
		})
	case KindTool:
		tool(c, item)
	case KindNotice:
		icon, color, label := (*ui.SVG)(nil), p.MutedForeground, ""
		switch {
		case item.Failed:
			icon, color, label = icons.X, p.Destructive, "Failed"
		case item.Level == "warn":
			icon, color, label = icons.TriangleAlert, t.Warning, "Warning"
		case item.Level == "success":
			icon, color, label = icons.Check, t.Success, "Done"
		case item.Level == "info":
			icon, label = icons.Info, "Note"
		}
		Marker(c, func() {
			if icon != nil {
				ui.Icon(c, icon).FontSize(16).TextColor(color).Label(label)
			}
		}, item.Text)
	case KindHelp:
		help(c, item.Help)
	}
}
