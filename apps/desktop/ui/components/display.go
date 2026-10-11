package components

// What shows and does nothing: Badge, Kbd, Spinner and Empty's head.

import (
	"math"

	"github.com/egoist/mygo/ui"
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

// Tag names a state in its color: the text in it, on a faint fill of it
// inside a seam of it.
func Tag(c *ui.Context, text string, color ui.Color) ui.Element {
	t := c.Theme()
	tag := ui.Row(c).AlignItems(ui.Center).Height(20).Padding(0, 6).Radius(4).Background(color.Alpha(0.1)).Border(1, color.Alpha(0.45)).Shrink(0)
	tag.Children(func() {
		ui.Text(c, text).FontSize(TextXS(t)).FontWeight(500).LetterSpacing(0.2).TextColor(color).SingleLine()
	})
	return tag
}

// Kbd is shadcn/ui's Kbd: a key to press.
func Kbd(c *ui.Context, key string) ui.Element {
	t := c.Theme()
	p := PaletteOf(t)
	k := ui.Row(c).Height(20).MinWidth(20).Padding(0, 4).Radius(4).Background(p.Accent).Justify(ui.Center).AlignItems(ui.Center).Shrink(0)
	k.Children(func() {
		ui.Text(c, key).FontSize(TextXS(t)).FontWeight(500).TextColor(p.MutedForeground).SingleLine()
	})
	return k
}

// Spinner is shadcn/ui's Spinner, Lucide's Loader2 turning once a second,
// size wide, in color or else muted, named by label. It turns from its
// Draw, a step each Tick: Loop builds the whole view anew every frame, and
// AnimationFrame paints the whole window again, both as many times a second
// as the display shows.
func Spinner(c *ui.Context, label string, size float32, color ui.Color) ui.Element {
	if color.A == 0 {
		color = PaletteOf(c.Theme()).MutedForeground
	}
	return ui.Box(c).Size(size, size).Shrink(0).Role(ui.RoleProgress).Label(label).Draw(func(p *ui.Painter, r ui.Rect) {
		p.After(UntilTick(p.Now()))
		turn := float64(p.Now().UnixMilli()%1000) / 1000 * 2 * math.Pi
		// Loader2's arc: radius 9 of 24, from 3 o'clock round to 72° short of it
		cx, cy, radius := r.X+r.W/2, r.Y+r.H/2, r.W*9/24
		var arc ui.Path
		const steps = 36
		for i := 0; i <= steps; i++ {
			a := turn + float64(i)/steps*1.6*math.Pi
			x, y := cx+radius*float32(math.Cos(a)), cy+radius*float32(math.Sin(a))
			if i == 0 {
				arc.MoveTo(x, y)
			} else {
				arc.LineTo(x, y)
			}
		}
		p.StrokePath(&arc, r.W/12, color)
	})
}

// Gauge is how full something is, value between 0 and 1: a ring filled
// clockwise from the top in color, on a track of quiet ink, size wide,
// named by label.
func Gauge(c *ui.Context, label string, value float64, size float32, color ui.Color) ui.Element {
	value = min(max(value, 0), 1)
	track := PaletteOf(c.Theme()).MutedForeground.Alpha(0.25)
	return ui.Box(c).Size(size, size).Shrink(0).Role(ui.RoleProgress).Range(0, 1, value).Label(label).Draw(func(p *ui.Painter, r ui.Rect) {
		width := r.W / 7
		cx, cy, radius := r.X+r.W/2, r.Y+r.H/2, (r.W-width)/2
		var ring ui.Path
		ring.Circle(cx, cy, radius)
		p.StrokePath(&ring, width, track)
		if value == 0 {
			return
		}

		var arc ui.Path
		steps := int(math.Ceil(value * 48))
		for i := 0; i <= steps; i++ {
			a := (float64(i)/float64(steps)*value - 0.25) * 2 * math.Pi
			x, y := cx+radius*float32(math.Cos(a)), cy+radius*float32(math.Sin(a))
			if i == 0 {
				arc.MoveTo(x, y)
			} else {
				arc.LineTo(x, y)
			}
		}
		p.StrokePath(&arc, width, color)
	})
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
