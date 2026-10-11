package components

import (
	"github.com/egoist/mygo/ui"
)

// TextInput is shadcn/ui's Input.
func TextInput(c *ui.Context, value *string) ui.Element {
	t := c.Theme()
	p := PaletteOf(t)
	box := ui.Row(c).Height(36).Padding(0, 12).Radius(t.Radius).AlignItems(ui.Center).Border(1, p.Input).
		Shadow(0, 1, 2, 0, ui.RGBA(0, 0, 0, 0.05)).Transition(ColorTransition)
	if t.Dark {
		box.Background(p.Input.Alpha(0.3))
	}
	var input ui.Element
	box.Children(func() {
		input = ui.TextInputBase(c, value).Grow(1)
	})
	if input.Focused() {
		box.Border(1, p.Ring).Shadow(0, 0, 0, 3, p.Ring.Alpha(0.5))
	}
	return input
}
