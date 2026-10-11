package conversation

import (
	"strings"

	"github.com/egoist/mygo/ui"

	"desktop/agentui/format"
	"desktop/agentui/icons"
	"desktop/agentui/shadcn"
	"desktop/agentui/transcript"
)

// tool is a call of a tool as shadcn/ui's Item, outlined and small: what
// it did beside how it went, its details folded under them.
func tool(c *ui.Context, item *transcript.Item) {
	t := c.Theme()
	p := shadcn.PaletteOf(t)
	call := item.Tool
	ui.Column(c).Padding(10, 14).Radius(t.Radius).Border(1, p.Border).Gap(6).Children(func() {
		// The disclosure's gap, so Details below lines up with the name
		ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
			switch {
			case !call.Done:
				shadcn.Spinner(c, "Running")
			case call.OK:
				ui.Icon(c, icons.Check).FontSize(16).TextColor(t.Success).Label("Succeeded")
			default:
				ui.Icon(c, icons.X).FontSize(16).TextColor(p.Destructive).Label("Failed")
			}
			ui.Text(c, call.Name).FontWeight(500).Font("monospace")
			ui.Text(c, format.OneLine(call.Args)).TextColor(p.MutedForeground).Font("monospace").FontSize(shadcn.TextXS(t)).SingleLine().Grow(1).Shrink(1)
			if call.Done {
				ui.Text(c, format.Duration(call.MS)).TextColor(p.MutedForeground).FontSize(shadcn.TextXS(t)).FontFeatures("tnum")
			}
		})
		shadcn.Disclosure(c, "Details", &item.Open, func() {
			Code(c, func() { ui.Text(c, call.Args).Font("monospace").FontSize(shadcn.TextXS(t)).Selectable() })
			if call.Done {
				output := call.Output
				if output == "" {
					output = "(no output)"
				}
				Code(c, func() {
					ui.Text(c, output).Font("monospace").FontSize(shadcn.TextXS(t)).TextColor(p.MutedForeground).Selectable()
				})
			}
		})
	})
}

// Code is a block of code: bg-muted rounded-md.
func Code(c *ui.Context, fn func()) ui.Element {
	return ui.Column(c).Padding(8, 12).Radius(c.Theme().Radius).Background(shadcn.PaletteOf(c.Theme()).Muted).Children(fn)
}

// Diff shows a command or a diff, its added and removed lines in color.
func Diff(c *ui.Context, text string) {
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
			ui.Text(c, line).Font("monospace").FontSize(shadcn.TextXS(t)).TextColor(color).NoWrap()
		}
	})
}
