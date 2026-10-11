package components

// Button and what it is drawn with: its variants and sizes, the fading
// of its colors and the ring of the keyboard focus.

import (
	"time"

	"github.com/egoist/mygo/ui"
)

type Variant int

const (
	Default     Variant = iota // bg-primary
	Secondary                  // bg-secondary
	Outline                    // border bg-background
	Ghost                      // only a hover
	Destructive                // bg-destructive
)

type Size int

const (
	SizeDefault        Size = iota // h-9 px-4
	SizeSmall                      // h-8 px-3
	SizeExtraSmall                 // h-6 px-2 text-xs
	SizeIconSmall                  // size-8
	SizeIconExtraSmall             // size-6
)

// sizes are each size's height, its padding without an icon and with one,
// the gap between icon and label, and the icon's size.
var sizes = [...]struct{ height, padding, iconPadding, gap, icon float32 }{
	SizeDefault:        {36, 16, 12, 8, 16},
	SizeSmall:          {32, 12, 10, 6, 16},
	SizeExtraSmall:     {24, 8, 6, 4, 12},
	SizeIconSmall:      {32, 0, 0, 0, 16},
	SizeIconExtraSmall: {24, 0, 0, 0, 12},
}

// ColorTransition fades a control's colors from state to state, as
// Tailwind's transitions do: 150 ms.
var ColorTransition = ui.ElementTransition{Duration: 150 * time.Millisecond, Colors: true}

// ButtonStyle is how a button looks: the zero value is shadcn/ui's
// default, in the primary color at the default size.
type ButtonStyle struct {
	Variant  Variant
	Size     Size
	Icon     *ui.SVG
	Disabled bool
}

// Button is shadcn/ui's Button: label after the style's icon, either of
// them left out. An icon alone needs a Label, for assistive technology.
func Button(c *ui.Context, label string, style ButtonStyle) ui.Element {
	t := c.Theme()
	p := PaletteOf(t)
	m, icon := sizes[style.Size], style.Icon
	b := ui.ButtonBase(c).Height(m.height).Radius(t.Radius).Gap(m.gap).FocusRing(false).Transition(ColorTransition).Shrink(0)
	if style.Disabled {
		b.Disabled(true).Opacity(0.5)
	}
	switch {
	case label == "":
		b.Width(m.height)
	case icon != nil:
		b.Padding(0, m.iconPadding)
	default:
		b.Padding(0, m.padding)
	}

	fill, text, hover, border := ui.Color{}, p.Foreground, p.Accent, ui.Color{}
	switch style.Variant {
	case Default:
		fill, text, hover = p.Primary, p.PrimaryForeground, p.Primary.Alpha(0.9)
	case Secondary:
		fill, hover = p.Secondary, p.Secondary.Alpha(0.8)
	case Outline:
		fill, border = p.Background, p.Border
		if t.Dark {
			fill, border, hover = p.Input.Alpha(0.3), p.Input, p.Input.Alpha(0.5)
		}
	case Ghost:
		if t.Dark {
			hover = p.Accent.Alpha(0.5)
		}
	case Destructive:
		fill, text, hover = p.Destructive, ui.Oklch(1, 0, 0), p.Destructive.Alpha(0.9)
		if t.Dark {
			fill, hover = p.Destructive.Alpha(0.6), p.Destructive.Alpha(0.5)
		}
	}
	if b.Hovered() {
		fill = hover
	}
	b.Background(fill).TextColor(text)
	if border.A > 0 {
		b.Border(1, border)
	}
	FocusRing(b, p, 0)
	b.Children(func() {
		if icon != nil {
			ui.Icon(c, icon).FontSize(m.icon).TextColor(text)
		}
		if label != "" {
			l := ui.Text(c, label).FontWeight(500).SingleLine()
			if style.Size == SizeExtraSmall {
				l.FontSize(TextXS(t))
			}
		}
	})
	return b
}

// FocusRing draws shadcn/ui's ring of the keyboard focus around e: its
// border in the ring color, and 3px of it at half strength outside.
func FocusRing(e ui.Element, p *Palette, width float32) {
	if !e.FocusVisible() {
		return
	}
	if width > 0 {
		e.Border(width, p.Ring)
	}
	e.Shadow(0, 0, 0, 3, p.Ring.Alpha(0.5))
}
