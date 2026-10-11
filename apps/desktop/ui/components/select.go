package components

import (
	"github.com/egoist/mygo/ui"

	"desktop/ui/icons"
)

// InlineSelect is shadcn/ui's Select with a trigger that reads as text, as
// the terminal's title shows a setting: muted, a small chevron after it, a fill
// while hovered; its popover of options marks the chosen one with a check.
func InlineSelect(c *ui.Context, selected *string, options []string, off bool) ui.Element {
	t := c.Theme()
	p := PaletteOf(t)
	sel := ui.SelectBase(c, selected)
	if off {
		sel.Trigger.Disabled(true)
	}
	trigger := sel.Trigger.Height(24).Padding(0, 2, 0, 6).Gap(2).Radius(6).AlignItems(ui.Center).Shrink(0).
		FocusRing(false).TextColor(p.MutedForeground).Transition(ColorTransition)
	if trigger.Hovered() {
		trigger.Background(p.Accent).TextColor(p.Foreground)
	}
	FocusRing(trigger, p, 1)
	trigger.Children(func() {
		ui.Text(c, *selected).SingleLine()
		if !off {
			ui.Icon(c, icons.ChevronDown).FontSize(14).TextColor(p.MutedForeground.Alpha(0.6))
		}
	})
	sel.Popup(func(panel ui.Element) {
		panel.Margin(4, 0, 0, 0).Padding(4).Radius(t.Radius).Background(p.Popover).Border(1, p.Border).
			Shadow(0, 4, 6, -1, ui.RGBA(0, 0, 0, 0.1)).MinWidth(128)
		for _, opt := range options {
			item := sel.Item(opt).Height(32).Padding(0, 8).Gap(8).Radius(6).AlignItems(ui.Center)
			if item.Highlighted() {
				item.Background(p.Accent)
			}
			item.Children(func() {
				ui.Text(c, opt).TextColor(p.Foreground).Grow(1).SingleLine()
				if opt == *selected {
					ui.Icon(c, icons.Check).FontSize(16).TextColor(p.Foreground)
				} else {
					ui.Box(c).Size(16, 16)
				}
			})
		}
	})
	return trigger
}
