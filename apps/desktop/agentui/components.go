package agentui

// Controls drawn as shadcn/ui's (new-york-v4) are: their variants, sizes
// and states in the palette's colors, built on the widgets' bases.

import (
	"time"

	"github.com/egoist/mygo/ui"
)

type variant int

const (
	variantDefault     variant = iota // bg-primary
	variantSecondary                  // bg-secondary
	variantOutline                    // border bg-background
	variantGhost                      // only a hover
	variantDestructive                // bg-destructive
)

type size int

const (
	sizeDefault        size = iota // h-9 px-4
	sizeSmall                      // h-8 px-3
	sizeExtraSmall                 // h-6 px-2 text-xs
	sizeIconSmall                  // size-8
	sizeIconExtraSmall             // size-6
)

// sizes are each size's height, its padding without an icon and with one,
// the gap between icon and label, and the icon's size.
var sizes = [...]struct{ height, padding, iconPadding, gap, icon float32 }{
	sizeDefault:        {36, 16, 12, 8, 16},
	sizeSmall:          {32, 12, 10, 6, 16},
	sizeExtraSmall:     {24, 8, 6, 4, 12},
	sizeIconSmall:      {32, 0, 0, 0, 16},
	sizeIconExtraSmall: {24, 0, 0, 0, 12},
}

// colorTransition fades a control's colors from state to state, as
// Tailwind's transitions do: 150 ms.
var colorTransition = ui.ElementTransition{Duration: 150 * time.Millisecond, Colors: true}

// buttonStyle is how a button looks: the zero value is shadcn/ui's
// default, in the primary color at the default size.
type buttonStyle struct {
	variant  variant
	size     size
	icon     *ui.SVG
	disabled bool
}

// button is shadcn/ui's Button: label after the style's icon, either of
// them left out. An icon alone needs a Label, for assistive technology.
func button(c *ui.Context, label string, style buttonStyle) ui.Element {
	t := c.Theme()
	p := paletteOf(t)
	m, icon := sizes[style.size], style.icon
	b := ui.ButtonBase(c).Height(m.height).Radius(t.Radius).Gap(m.gap).FocusRing(false).Transition(colorTransition).Shrink(0)
	if style.disabled {
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
	switch style.variant {
	case variantDefault:
		fill, text, hover = p.Primary, p.PrimaryForeground, p.Primary.Alpha(0.9)
	case variantSecondary:
		fill, hover = p.Secondary, p.Secondary.Alpha(0.8)
	case variantOutline:
		fill, border = p.Background, p.Border
		if t.Dark {
			fill, border, hover = p.Input.Alpha(0.3), p.Input, p.Input.Alpha(0.5)
		}
		b.Shadow(0, 1, 2, 0, ui.RGBA(0, 0, 0, 0.05))
	case variantGhost:
		if t.Dark {
			hover = p.Accent.Alpha(0.5)
		}
	case variantDestructive:
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
	focusRing(b, p, 0)
	b.Children(func() {
		if icon != nil {
			ui.Icon(c, icon).FontSize(m.icon).TextColor(text)
		}
		if label != "" {
			l := ui.Text(c, label).FontWeight(500).SingleLine()
			if style.size == sizeExtraSmall {
				l.FontSize(textXS(t))
			}
		}
	})
	return b
}

// focusRing draws shadcn/ui's ring of the keyboard focus around e: its
// border in the ring color, and 3px of it at half strength outside.
func focusRing(e ui.Element, p *palette, width float32) {
	if !e.FocusVisible() {
		return
	}
	if width > 0 {
		e.Border(width, p.Ring)
	}
	e.Shadow(0, 0, 0, 3, p.Ring.Alpha(0.5))
}

// badge is shadcn/ui's Badge: a short text in a pill.
func badge(c *ui.Context, text string, v variant) ui.Element {
	t := c.Theme()
	p := paletteOf(t)
	fill, color, border := p.Primary, p.PrimaryForeground, ui.Color{}
	switch v {
	case variantSecondary:
		fill, color = p.Secondary, p.Foreground
	case variantOutline:
		fill, color, border = ui.Color{}, p.Foreground, p.Border
	case variantDestructive:
		fill, color = p.Destructive, ui.Oklch(1, 0, 0)
		if t.Dark {
			fill = p.Destructive.Alpha(0.6)
		}
	}
	b := ui.Row(c).AlignItems(ui.Center).Padding(2, 8).Radius(999).Background(fill).Shrink(0)
	b.Border(1, border)
	b.Children(func() {
		ui.Text(c, text).FontSize(textXS(t)).FontWeight(500).TextColor(color).SingleLine()
	})
	return b
}

// kbd is shadcn/ui's Kbd: a key to press.
func kbd(c *ui.Context, key string) ui.Element {
	t := c.Theme()
	p := paletteOf(t)
	k := ui.Row(c).Height(20).MinWidth(20).Padding(0, 4).Radius(6).Background(p.Muted).Justify(ui.Center).AlignItems(ui.Center).Shrink(0)
	k.Children(func() {
		ui.Text(c, key).FontSize(textXS(t)).FontWeight(500).TextColor(p.MutedForeground).SingleLine()
	})
	return k
}

// spinner is shadcn/ui's Spinner: a turning Loader2, named by label.
func spinner(c *ui.Context, label string) ui.Element {
	spin := ui.Icon(c, loaderIcon).FontSize(16).TextColor(paletteOf(c.Theme()).MutedForeground).Label(label)
	return spin.Rotate(spin.Loop("spin", time.Second, ui.Linear) * 360)
}

// emptyHeader is the head of shadcn/ui's Empty: an icon on a tile, a
// title, and what to do about it.
func emptyHeader(c *ui.Context, icon *ui.SVG, title, description string) {
	t := c.Theme()
	p := paletteOf(t)
	ui.Column(c).MaxWidth(384).Gap(8).AlignItems(ui.Center).Children(func() {
		ui.Row(c).Size(40, 40).Margin(0, 0, 8).Radius(10).Background(p.Muted).Justify(ui.Center).AlignItems(ui.Center).Children(func() {
			ui.Icon(c, icon).FontSize(24).TextColor(p.Foreground)
		})
		ui.Text(c, title).FontSize(textLG(t)).FontWeight(500).LetterSpacing(-0.4).TextAlign(ui.Center)
		ui.Text(c, description).TextColor(p.MutedForeground).LineHeight(1.625).TextAlign(ui.Center)
	})
}

// inlineSelect is shadcn/ui's Select with a trigger that reads as text, as
// the terminal's title shows a setting: muted, a small chevron after it, a fill
// while hovered; its popover of options marks the chosen one with a check.
func inlineSelect(c *ui.Context, selected *string, options []string, off bool) ui.Element {
	t := c.Theme()
	p := paletteOf(t)
	sel := ui.SelectBase(c, selected)
	if off {
		sel.Trigger.Disabled(true)
	}
	trigger := sel.Trigger.Height(24).Padding(0, 2, 0, 6).Gap(2).Radius(6).AlignItems(ui.Center).Shrink(0).
		FocusRing(false).TextColor(p.MutedForeground).Transition(colorTransition)
	if trigger.Hovered() {
		trigger.Background(p.Accent).TextColor(p.Foreground)
	}
	focusRing(trigger, p, 1)
	trigger.Children(func() {
		ui.Text(c, *selected).SingleLine()
		if !off {
			ui.Icon(c, chevronDownIcon).FontSize(14).TextColor(p.MutedForeground.Alpha(0.6))
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
					ui.Icon(c, checkIcon).FontSize(16).TextColor(p.Foreground)
				} else {
					ui.Box(c).Size(16, 16)
				}
			})
		}
	})
	return trigger
}

// textInput is shadcn/ui's Input.
func textInput(c *ui.Context, value *string) ui.Element {
	t := c.Theme()
	p := paletteOf(t)
	box := ui.Row(c).Height(36).Padding(0, 12).Radius(t.Radius).AlignItems(ui.Center).Border(1, p.Input).
		Shadow(0, 1, 2, 0, ui.RGBA(0, 0, 0, 0.05)).Transition(colorTransition)
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

// Lucide's icons, which shadcn/ui draws with: 24 by 24, stroked 2 wide.
var (
	archiveIcon        = lucide(`<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>`)
	archiveRestoreIcon = lucide(`<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h2"/><path d="M20 8v11a2 2 0 0 1-2 2h-2"/><path d="m9 15 3-3 3 3"/><path d="M12 12v9"/>`)
	arrowUpIcon        = lucide(`<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>`)
	checkIcon          = lucide(`<path d="M20 6 9 17l-5-5"/>`)
	chevronDownIcon    = lucide(`<path d="m6 9 6 6 6-6"/>`)
	folderOpenIcon     = lucide(`<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>`)
	infoIcon           = lucide(`<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>`)
	loaderIcon         = lucide(`<path d="M21 12a9 9 0 1 1-6.219-8.56"/>`)
	plusIcon           = lucide(`<path d="M5 12h14"/><path d="M12 5v14"/>`)
	squareIcon         = lucide(`<rect width="14" height="14" x="5" y="5" rx="2" fill="currentColor"/>`)
	triangleAlertIcon  = lucide(`<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>`)
	xIcon              = lucide(`<path d="M18 6 6 18"/><path d="m6 6 12 12"/>`)
)

func lucide(shapes string) *ui.SVG {
	return ui.MustParseSVG([]byte(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` + shapes + `</svg>`))
}
