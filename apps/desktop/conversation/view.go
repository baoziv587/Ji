// Package conversation is a session's conversation: built from the
// service's events (logic.go, work.go), and drawn (view.go) as the
// messages, the reply's text, the work between it folded into a line each
// (work_view.go) and the notices, in a column as wide as it reads well, in
// the middle of the window; and a step of the work whole (inspect.go).
package conversation

import (
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
// from it. A list, which builds only the rows in view: built whole, a long
// session took longer than a frame for every delta of a reply. A reply is
// a row for each of its blocks, and its text is selected with the rest.
func View(c *ui.Context, list *ui.ListState, t *Transcript) ui.Element {
	theme := c.Theme()
	p := components.PaletteOf(theme)
	list.FollowEnd = true
	view := ui.List(c, list, t.rows(), func(i int) {
		k, part := t.row(i)
		b := t.Blocks[k]
		row := Centered(c, 0, func() {
			switch {
			case b.Work != nil:
				work(c, t, b.Work)
			case b.Item.Kind == KindText:
				markdownBlock(c, &b.Item.md.blocks[part])
			default:
				item(c, b.Item)
			}
		})
		if i > 0 && part == 0 {
			row.Padding(16, 0, 0)
		}
	}).Grow(1).Padding(24).Selectable().Children(func() {
		if len(t.Items) > 0 {
			return
		}
		Centered(c, 16, func() {
			if t.State.ID == "" {
				Marker(
					c,
					func() { components.Spinner(c, "Opening", 16, ui.Color{}) },
					"Opening the session…",
				)
				return
			}
			ui.Column(c).Center().Gap(12).Padding(80, 0).Unselectable().Children(func() {
				ui.Text(c, "What should we work on?").
					FontSize(components.TextLG(theme)).
					FontWeight(500).
					LetterSpacing(-0.4)
				ui.Row(c).Gap(16).Children(func() {
					for _, hint := range [][2]string{
						{"↵", "to send"},
						{"⇧↵", "for a new line"},
						{"/", "for commands"},
					} {
						ui.Row(c).Gap(6).AlignItems(ui.Center).Children(func() {
							components.Kbd(c, hint[0])
							ui.Text(c, hint[1]).
								FontSize(components.TextXS(theme)).
								TextColor(p.MutedForeground)
						})
					}
				})
			})
		})
	})
	t.sight = view.Bounds()
	return view
}

// Marker is shadcn/ui's Marker: a note in the conversation that is no
// one's message, after an icon.
func Marker(c *ui.Context, icon func(), text string) ui.Element {
	p := components.PaletteOf(c.Theme())
	return ui.Row(c).Gap(8).AlignItems(ui.Start).Children(func() {
		icon()
		// MinWidth(0): a word longer than the row, a link say, breaks
		// rather than pushing the row past the window
		ui.Text(c, text).TextColor(p.MutedForeground).LineHeight(1.25).Shrink(1).MinWidth(0)
	})
}

func item(c *ui.Context, item *Item) {
	t := c.Theme()
	p := components.PaletteOf(t)
	switch item.Kind {
	case KindUser:
		// A raised panel at the end: the user's own words
		ui.Row(c).Justify(ui.End).Children(func() {
			ui.Column(c).
				MaxWidth(Width*0.8).
				Padding(8, 12).
				Radius(t.Radius).
				Background(p.Secondary).
				Border(1, p.Border).
				Gap(4).
				Children(func() {
					ui.Text(c, item.Text).LineHeight(1.625)
					if item.Steer {
						ui.Text(c, "steer").
							FontSize(components.TextXS(t)).
							FontWeight(500).
							TextColor(p.MutedForeground)
					}
				})
		})
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
	case KindCompaction:
		compaction(c, item)
	}
}
