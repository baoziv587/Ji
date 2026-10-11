package shadcn

// What shows and does nothing: Badge, Kbd, Spinner and Empty's head.

import (
	"time"

	"github.com/egoist/mygo/ui"

	"desktop/agentui/icons"
)

// Badge is shadcn/ui's Badge: a short text in a pill.
func Badge(c *ui.Context, text string, v Variant) ui.Element {
	t := c.Theme()
	p := PaletteOf(t)
	fill, color, border := p.Primary, p.PrimaryForeground, ui.Color{}
	switch v {
	case Secondary:
		fill, color = p.Secondary, p.Foreground
	case Outline:
		fill, color, border = ui.Color{}, p.Foreground, p.Border
	case Destructive:
		fill, color = p.Destructive, ui.Oklch(1, 0, 0)
		if t.Dark {
			fill = p.Destructive.Alpha(0.6)
		}
	}
	b := ui.Row(c).AlignItems(ui.Center).Padding(2, 8).Radius(999).Background(fill).Shrink(0)
	b.Border(1, border)
	b.Children(func() {
		ui.Text(c, text).FontSize(TextXS(t)).FontWeight(500).TextColor(color).SingleLine()
	})
	return b
}

// Kbd is shadcn/ui's Kbd: a key to press.
func Kbd(c *ui.Context, key string) ui.Element {
	t := c.Theme()
	p := PaletteOf(t)
	k := ui.Row(c).Height(20).MinWidth(20).Padding(0, 4).Radius(6).Background(p.Muted).Justify(ui.Center).AlignItems(ui.Center).Shrink(0)
	k.Children(func() {
		ui.Text(c, key).FontSize(TextXS(t)).FontWeight(500).TextColor(p.MutedForeground).SingleLine()
	})
	return k
}

// Spinner is shadcn/ui's Spinner: a turning Loader2, named by label.
func Spinner(c *ui.Context, label string) ui.Element {
	spin := ui.Icon(c, icons.Loader).FontSize(16).TextColor(PaletteOf(c.Theme()).MutedForeground).Label(label)
	return spin.Rotate(spin.Loop("spin", time.Second, ui.Linear) * 360)
}

// EmptyHeader is the head of shadcn/ui's Empty: an icon on a tile, a
// title, and what to do about it.
func EmptyHeader(c *ui.Context, icon *ui.SVG, title, description string) {
	t := c.Theme()
	p := PaletteOf(t)
	ui.Column(c).MaxWidth(384).Gap(8).AlignItems(ui.Center).Children(func() {
		ui.Row(c).Size(40, 40).Margin(0, 0, 8).Radius(10).Background(p.Muted).Justify(ui.Center).AlignItems(ui.Center).Children(func() {
			ui.Icon(c, icon).FontSize(24).TextColor(p.Foreground)
		})
		ui.Text(c, title).FontSize(TextLG(t)).FontWeight(500).LetterSpacing(-0.4).TextAlign(ui.Center)
		ui.Text(c, description).TextColor(p.MutedForeground).LineHeight(1.625).TextAlign(ui.Center)
	})
}
