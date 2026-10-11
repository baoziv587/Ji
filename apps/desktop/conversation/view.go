// Package conversation is a session's conversation: built from the
// service's events (logic.go), and drawn (view.go) as the messages, the
// reply's text and thinking, the calls of tools and the notices, in a
// column as wide as it reads well, in the middle of the window.
package conversation

import (
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

// View is the conversation, kept at its end as it grows unless scrolled up
// from it. A list, which builds only the items in view: built whole, a long
// session took longer than a frame for every delta of a reply.
func View(c *ui.Context, list *ui.ListState, t *Transcript) ui.Element {
	theme := c.Theme()
	p := components.PaletteOf(theme)
	list.FollowEnd = true
	return ui.List(c, list, len(t.Items), func(i int) {
		Centered(c, 0, func() { item(c, t.Items[i]) })
	}).Grow(1).Gap(16).Padding(24).Children(func() {
		if len(t.Items) > 0 {
			return
		}
		Centered(c, 16, func() {
			if t.State.ID == "" {
				Marker(c, func() { components.Spinner(c, "Opening", 16, ui.Color{}) }, "Opening the session…")
				return
			}
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

// streamed draws text that grows as a reply streams in, in pieces that
// end at a line break: a layout is kept by its whole text, so one Text
// was shaped again in full for every delta, and only the last piece is.
func streamed(c *ui.Context, text string, color ui.Color) ui.Element {
	return ui.Column(c).Selectable().Children(func() {
		for _, piece := range pieces(strings.TrimSpace(text)) {
			ui.Text(c, piece).TextColor(color).LineHeight(1.625)
		}
	})
}

// pieces cuts s at the first line break past every pieceSize bytes; a piece
// once cut stays the same as s grows.
func pieces(s string) []string {
	var out []string
	for len(s) > pieceSize {
		n := strings.IndexByte(s[pieceSize:], '\n')
		if n < 0 {
			break
		}
		out = append(out, s[:pieceSize+n])
		s = s[pieceSize+n+1:]
	}
	return append(out, s)
}

const pieceSize = 2048

func item(c *ui.Context, item *Item) {
	t := c.Theme()
	p := components.PaletteOf(t)
	switch item.Kind {
	case KindUser:
		// A raised panel at the end: the user's own words
		ui.Row(c).Justify(ui.End).Children(func() {
			ui.Column(c).MaxWidth(Width*0.8).Padding(8, 12).Radius(t.Radius).Background(p.Secondary).Border(1, p.Border).Gap(4).Children(func() {
				ui.Text(c, item.Text).Selectable().LineHeight(1.625)
				if item.Steer {
					ui.Text(c, "steer").FontSize(components.TextXS(t)).FontWeight(500).TextColor(p.MutedForeground)
				}
			})
		})
	case KindText:
		streamed(c, item.Text, p.Foreground)
	case KindThinking:
		components.Disclosure(c, "Thinking", p.Thinking, &item.Open, func() {
			// In by the chevron and its gap, 16 + 8, so it sits under the label
			streamed(c, item.Text, p.MutedForeground).Padding(0, 0, 0, 24)
		})
	case KindTool:
		tool(c, item)
	case KindNotice:
		icon, color, label := (*ui.SVG)(nil), p.MutedForeground, ""
		switch {
		case item.Failed:
			icon, color, label = icons.X, p.Destructive, "Failed"
		case item.Level == "warn":
			icon, color, label = icons.TriangleAlert, p.Warning, "Warning"
		case item.Level == "success":
			icon, color, label = icons.Check, p.Success, "Done"
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
