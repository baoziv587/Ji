package conversation

import (
	"github.com/egoist/mygo/ui"

	"desktop/format"
	"desktop/ui/components"
	"desktop/ui/icons"
)

// tool is a call of a tool as shadcn/ui's Item, outlined and small: what
// it did beside how it went, its details folded under them.
func tool(c *ui.Context, item *Item) {
	t := c.Theme()
	p := components.PaletteOf(t)
	call := item.Tool
	ui.Column(c).Padding(10, 14).Radius(t.Radius).Border(1, p.Border).Background(p.Card).Gap(6).Children(func() {
		// The disclosure's gap, so Details below lines up with the name
		ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
			switch {
			case !call.Done:
				components.Spinner(c, "Running", 16, p.Primary)
			case call.OK:
				ui.Icon(c, icons.Check).FontSize(16).TextColor(p.Success).Label("Succeeded")
			default:
				ui.Icon(c, icons.X).FontSize(16).TextColor(p.Destructive).Label("Failed")
			}
			ui.Text(c, call.Name).FontWeight(500).Font("monospace")
			ui.Text(c, call.Summary).TextColor(p.MutedForeground).Font("monospace").FontSize(components.TextXS(t)).SingleLine().Grow(1).Shrink(1)
			if call.Done {
				ui.Text(c, format.Duration(call.MS)).TextColor(p.MutedForeground).Font("monospace").FontSize(components.TextXS(t)).FontFeatures("tnum")
			}
		})
		components.Disclosure(c, "Details", ui.Color{}, &item.Open, func() {
			Code(c, func() { ui.Text(c, call.Args).Font("monospace").FontSize(components.TextXS(t)).Selectable() })
			if call.Done {
				output := call.Output
				if output == "" {
					output = "(no output)"
				}
				Code(c, func() {
					ui.Text(c, output).Font("monospace").FontSize(components.TextXS(t)).TextColor(p.MutedForeground).Selectable()
				})
			}
		})
	})
}

// Code is a block of code: bg-muted rounded-md.
func Code(c *ui.Context, fn func()) ui.Element {
	return ui.Column(c).Padding(8, 12).Radius(c.Theme().Radius).Background(components.PaletteOf(c.Theme()).Muted).Children(fn)
}

// Diff shows a command or a diff, its added and removed lines in color on
// a faint band of it, so they read apart from the states drawn in the same
// hues. A list, which builds only the lines in view: a write's are the
// whole file.
func Diff(c *ui.Context, lines []DiffLine) ui.Element {
	t := c.Theme()
	p := components.PaletteOf(t)
	return ui.List(c, nil, len(lines), func(i int) {
		line := lines[i]
		color, band := t.Text, ui.Color{}
		switch line.Kind {
		case DiffMeta:
			color = t.TextMuted
		case DiffAdded:
			color, band = p.Success, p.Success.Alpha(0.12)
		case DiffRemoved:
			color, band = p.Destructive, p.Destructive.Alpha(0.12)
		}
		if !t.Dark && band.A > 0 {
			// On the band the hue alone falls short of 4.5:1 in light
			color, band = color.Mix(p.Foreground, 0.3), band.Alpha(0.6)
		}
		ui.Text(c, line.Text).Font("monospace").FontSize(components.TextXS(t)).TextColor(color).NoWrap().
			Background(band).Padding(1, 12)
	}).Selectable()
}
