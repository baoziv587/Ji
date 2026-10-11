package components

import (
	"github.com/egoist/mygo/ui"
)

// TextInput is shadcn/ui's Input.
func TextInput(c *ui.Context, value *string) ui.Element {
	t := c.Theme()
	p := PaletteOf(t)
	box := ui.Row(c).Height(36).Padding(0, 12).Radius(t.Radius).AlignItems(ui.Center).Border(1, p.Input).Background(p.Card).
		Transition(ColorTransition)
	var input ui.Element
	box.Children(func() {
		input = ui.TextInputBase(c, value).Grow(1)
	})
	if input.Focused() {
		box.Border(1, p.Ring).Shadow(0, 0, 0, 3, p.Ring.Alpha(0.25))
	}
	return input
}
