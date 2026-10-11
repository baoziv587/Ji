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
// that one aside.
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
}

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
	t.Accent, t.AccentHover, t.AccentPressed, t.AccentText = p.Primary, p.Primary.Alpha(0.9), p.Primary.Alpha(0.8), p.PrimaryForeground
	t.Danger, t.Success, t.Warning = p.Destructive, p.Success, p.Warning
	// Tooltips as theirs: bg-foreground text-background
	t.Inverse, t.InverseText = p.Foreground, p.Background
	t.Selection, t.Focus, t.Scrollbar = p.Primary.Alpha(0.3), p.Ring.Alpha(0.25), p.Foreground.Alpha(0.25)
	// rounded-md: --radius, 0.625rem, less 2px
	t.Radius, t.Spacing = 8, 4
	return &t
}

// Sizes of text as Tailwind's, for a body of text-sm: the system's size,
// 13 on macOS where the web's is 14.
func TextXS(t *ui.Theme) float32 { return t.FontSize - 2 }
func TextLG(t *ui.Theme) float32 { return t.FontSize + 4 }
