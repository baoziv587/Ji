package conversation

import (
	"strings"

	"github.com/egoist/mygo/ui"

	"desktop/agent"
	"desktop/ui/components"
)

// help is what /help lists, then the window's own keys, in a box of its
// own: each part's title small and muted, its rows a key and what it does.
func help(c *ui.Context, sections []agent.HelpSection) {
	t := c.Theme()
	p := components.PaletteOf(t)
	keys := agent.HelpSection{Title: "Keys", Rows: [][2]string{
		{"↵", "sends, or steers a reply"}, {"⇧↵", "a new line"}, {"esc", "stops a reply"},
		{"⇧⇥", "switches ask/auto"}, {"/", "opens the commands"},
	}}
	ui.Column(c).Padding(12, 14).Radius(t.Radius).Border(1, p.Border).Gap(12).Children(func() {
		for i, section := range append(append([]agent.HelpSection{}, sections...), keys) {
			ui.Column(c.Key(i)).Gap(4).Children(func() {
				ui.Text(c, section.Title).
					FontSize(components.TextXS(t)).
					FontWeight(500).
					TextColor(p.MutedForeground)
				if section.Text != "" {
					ui.Text(c, section.Text).LineHeight(1.625)
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
								components.Kbd(c, key)
							}
						})
						ui.Text(c, row[1]).TextColor(p.MutedForeground).Shrink(1)
					})
				}
			})
		}
	})
}
