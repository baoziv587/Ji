package components

import (
	"github.com/egoist/mygo/ui"

	"desktop/ui/icons"
)

// Disclosure is shadcn/ui's Collapsible as AI Elements' Reasoning draws
// it: a muted trigger, its chevron turning as it opens, that a hover brings
// to the foreground; what fn builds below it. The chevron takes an icon's
// 16px and its 8px gap, so the label lines up with text after an icon.
func Disclosure(c *ui.Context, label string, open *bool, fn func()) ui.Element {
	p := PaletteOf(c.Theme())
	return ui.Column(c).Shrink(0).Children(func() {
		parts := ui.CollapsibleBase(c, open)

		trigger := parts.Trigger.AlignSelf(ui.Start).Height(20).Gap(8).Radius(4).AlignItems(ui.Center).
			FocusRing(false).TextColor(p.MutedForeground).Transition(ColorTransition)
		if trigger.Hovered() {
			trigger.TextColor(p.Foreground)
		}
		FocusRing(trigger, p, 0)
		trigger.Children(func() {
			ui.Icon(c, icons.ChevronRight).FontSize(16).Rotate(90 * parts.Progress())
			ui.Text(c, label).SingleLine()
		})

		parts.Panel(func() {
			ui.Column(c).Padding(8, 0, 0).Gap(8).Children(fn)
		})
	})
}
