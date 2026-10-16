// Package components draws the window's controls on shadcn/ui's
// (new-york-v4) anatomy, in one of Ji's color schemes, light and dark,
// divided by 1px seams, where color stands for state or action.
// The theme the widgets of MyGo draw with is made from the scheme's palette.
package components

import "github.com/egoist/mygo/ui"

// Palette holds shadcn/ui's tokens, by their names there, and the colors
// of what a session is doing. Hue is kept for meaning: the brand is what
// to do and what runs; orange only what waits for the user; green done;
// red failed or destructive. Thinking is the brand's hue, quieter, and
// nothing is violet. A scheme whose brand sits on one of these hues moves
// that one aside. Code is in four hues more, the brand's for its keywords
// and three apart from it, as light as the text is dark enough to read on
// any surface.
type Palette struct {
	Background, Foreground     ui.Color
	Card, Popover              ui.Color
	Primary, PrimaryForeground ui.Color
	Secondary, Muted, Accent   ui.Color
	MutedForeground            ui.Color
	Destructive                ui.Color
	Border, Input, Ring        ui.Color
	Sidebar, SidebarAccent     ui.Color
	SidebarBorder              ui.Color
	Info, Warning              ui.Color
	Waiting, Success, Thinking ui.Color
	// Code in a sentence: a deep shade of the brand, on CodeSpan.
	Emphasis ui.Color
	// Code's keywords, strings, numbers and types.
	CodeKeyword, CodeString ui.Color
	CodeNumber, CodeType    ui.Color
}

// CodeSpan is what code in a sentence is on: the brand, let through, so
// that it takes on whatever it is on, a message or a card. A grey brand,
// near black or white, is let through half as much, or it reads heavy.
func (p *Palette) CodeSpan() ui.Color {
	if p.Grey() {
		return p.Primary.Alpha(0.07)
	}
	return p.Primary.Alpha(0.14)
}

// CodeKind is what code in a sentence names.
type CodeKind int

const (
	CodeWord CodeKind = iota
	CodePath
	CodeCall
)

// InlineCode is the ink of code in a sentence and what it is on, by what
// it names: a path in the strings' hue, a call or a member in the types',
// any other word in the brand's, each on its own hue let through, so that
// a reply full of code is not all one hue.
func (p *Palette) InlineCode(kind CodeKind) (ink, ground ui.Color) {
	switch kind {
	case CodePath:
		return p.CodeString, p.CodeString.Alpha(0.14)
	case CodeCall:
		return p.CodeType, p.CodeType.Alpha(0.14)
	}
	return p.Emphasis, p.CodeSpan()
}

// Stressed is the text of a heading or of bold text: the text's color
// with a trace of the brand's, which stand out by their weight.
func (p *Palette) Stressed() ui.Color { return p.Foreground.Mix(p.Primary, 0.05) }

// Link is the text of a link in a sentence: the brand drawn toward the
// text, as a link is underlined only under the pointer and reads by its
// hue alone, at body size.
func (p *Palette) Link() ui.Color { return p.Primary.Mix(p.Foreground, 0.3) }

// Grey is whether the brand is a grey, as a monochrome scheme's: then its
// hue sets nothing apart, and a link is underlined even away from the
// pointer.
func (p *Palette) Grey() bool {
	c := p.Primary
	return max(c.R, c.G, c.B)-min(c.R, c.G, c.B) <= 4
}

// Quoted is the text of a quote: a step below the text, not as far down
// as quiet ink, as a quote is read through.
func (p *Palette) Quoted() ui.Color { return p.Foreground.Mix(p.MutedForeground, 0.4) }

type Scheme struct {
	Name        string
	Light, Dark Palette
}

func (s *Scheme) Of(dark bool) *Palette {
	if dark {
		return &s.Dark
	}
	return &s.Light
}

// SchemeNamed is the scheme of that name, or the default one.
func SchemeNamed(name string) *Scheme {
	for _, s := range Schemes {
		if s.Name == name {
			return s
		}
	}
	return Schemes[0]
}

type Appearance string

const (
	System Appearance = "system"
	Light  Appearance = "light"
	Dark   Appearance = "dark"
)

func (a Appearance) IsDark(systemDark bool) bool {
	switch a {
	case Light:
		return false
	case Dark:
		return true
	}
	return systemDark
}

// active is the scheme PaletteOf reads from. Controls are handed only the
// theme, which says light or dark but not which scheme; there is one
// window, and its view sets the scheme with Use before it builds.
var active = Schemes[0]

func Use(s *Scheme) { active = s }

// PaletteOf is the palette that goes with a theme, light or dark, in the
// scheme in use.
func PaletteOf(t *ui.Theme) *Palette {
	return active.Of(t.Dark)
}

// Theme makes the theme of the widgets from s, light or dark: a copy of
// the system's theme that keeps what follows the desktop, as the size of
// text.
func Theme(system *ui.Theme, s *Scheme, dark bool) *ui.Theme {
	p := s.Of(dark)
	t := *system
	t.Dark = dark

	t.Background, t.Text, t.TextMuted, t.Border = p.Background, p.Foreground, p.MutedForeground, p.Border
	t.Surface, t.SurfaceHover, t.SurfacePressed = p.Secondary, p.Accent, p.Accent

	t.Accent = p.Primary
	t.AccentHover = p.Primary.Alpha(0.9)
	t.AccentPressed = p.Primary.Alpha(0.8)
	t.AccentText = p.PrimaryForeground

	t.Danger, t.Success, t.Warning = p.Destructive, p.Success, p.Warning
	// Tooltips as theirs: bg-foreground text-background
	t.Inverse, t.InverseText = p.Foreground, p.Background

	t.Selection = p.Primary.Alpha(0.3)
	t.Focus = p.Ring.Alpha(0.25)
	t.Scrollbar = p.Foreground.Alpha(0.25)

	// rounded-md: --radius, 0.625rem, less 2px
	t.Radius, t.Spacing = 8, 4
	return &t
}

// Sizes of text as Tailwind's, for a body of text-sm: the system's size,
// 13 on macOS where the web's is 14.
func TextXS(t *ui.Theme) float32 { return t.FontSize - 2 }
func TextLG(t *ui.Theme) float32 { return t.FontSize + 4 }

// TextCode is the size of code in a reply, a step under the body: at
// TextXS its colors blur.
func TextCode(t *ui.Theme) float32 { return t.FontSize - 1 }
