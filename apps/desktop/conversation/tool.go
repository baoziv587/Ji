package conversation

import (
	"github.com/egoist/mygo/ui"

	"desktop/ui/components"
)

// Code is a block of code: bg-muted rounded-md.
func Code(c *ui.Context, fn func()) ui.Element {
	return ui.Column(c).Padding(8, 12).Radius(c.Theme().Radius).Background(components.PaletteOf(c.Theme()).Muted).Children(fn)
}

// Diff shows a command or a diff in color, its added and removed lines on
// a faint band of their side's hue, so they read apart from the states
// drawn in the same hues. A list, which builds only the lines in view: a
// write's are the whole file.
func Diff(c *ui.Context, lines []DiffLine) ui.Element {
	t := c.Theme()
	return ui.List(c, nil, len(lines), func(i int) {
		_, band := diffColors(t, lines[i].Kind)
		codeLine(c, lines[i]).NoWrap().Background(band).Padding(1, 12)
	}).Selectable()
}

// diffColors are the text and the band of a line of a diff of kind.
func diffColors(t *ui.Theme, kind DiffKind) (color, band ui.Color) {
	p := components.PaletteOf(t)
	color = t.Text
	switch kind {
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
	return color, band
}
