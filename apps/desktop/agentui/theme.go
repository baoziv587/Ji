package agentui

// The window's look: shadcn/ui's neutral theme (new-york-v4), its tokens
// as they are there, and the theme the widgets of MyGo draw with made
// from them.

import "github.com/egoist/mygo/ui"

// palette holds shadcn/ui's tokens, by their names there.
type palette struct {
	Background, Foreground     ui.Color
	Card, Popover              ui.Color
	Primary, PrimaryForeground ui.Color
	Secondary, Muted, Accent   ui.Color
	MutedForeground            ui.Color
	Destructive                ui.Color
	Border, Input, Ring        ui.Color
	Sidebar, SidebarAccent     ui.Color
	SidebarBorder              ui.Color
	// shadcn/ui has no token of it: Tailwind's sky, for what the
	// terminal shows in cyan.
	Info ui.Color
}

var lightPalette = palette{
	Background:        ui.Oklch(1, 0, 0),
	Foreground:        ui.Oklch(0.145, 0, 0),
	Card:              ui.Oklch(1, 0, 0),
	Popover:           ui.Oklch(1, 0, 0),
	Primary:           ui.Oklch(0.205, 0, 0),
	PrimaryForeground: ui.Oklch(0.985, 0, 0),
	Secondary:         ui.Oklch(0.97, 0, 0),
	Muted:             ui.Oklch(0.97, 0, 0),
	Accent:            ui.Oklch(0.97, 0, 0),
	MutedForeground:   ui.Oklch(0.556, 0, 0),
	Destructive:       ui.Oklch(0.577, 0.245, 27.325),
	Border:            ui.Oklch(0.922, 0, 0),
	Input:             ui.Oklch(0.922, 0, 0),
	Ring:              ui.Oklch(0.708, 0, 0),
	Sidebar:           ui.Oklch(0.985, 0, 0),
	SidebarAccent:     ui.Oklch(0.97, 0, 0),
	SidebarBorder:     ui.Oklch(0.922, 0, 0),
	Info:              ui.Oklch(0.588, 0.158, 241.966),
}

var darkPalette = palette{
	Background:        ui.Oklch(0.145, 0, 0),
	Foreground:        ui.Oklch(0.985, 0, 0),
	Card:              ui.Oklch(0.205, 0, 0),
	Popover:           ui.Oklch(0.205, 0, 0),
	Primary:           ui.Oklch(0.922, 0, 0),
	PrimaryForeground: ui.Oklch(0.205, 0, 0),
	Secondary:         ui.Oklch(0.269, 0, 0),
	Muted:             ui.Oklch(0.269, 0, 0),
	Accent:            ui.Oklch(0.269, 0, 0),
	MutedForeground:   ui.Oklch(0.708, 0, 0),
	Destructive:       ui.Oklch(0.704, 0.191, 22.216),
	Border:            ui.Oklch(1, 0, 0).Alpha(0.1),
	Input:             ui.Oklch(1, 0, 0).Alpha(0.15),
	Ring:              ui.Oklch(0.556, 0, 0),
	Sidebar:           ui.Oklch(0.205, 0, 0),
	SidebarAccent:     ui.Oklch(0.269, 0, 0),
	SidebarBorder:     ui.Oklch(1, 0, 0).Alpha(0.1),
	Info:              ui.Oklch(0.746, 0.16, 232.661),
}

// paletteOf is the palette that goes with a theme, light or dark.
func paletteOf(t *ui.Theme) *palette {
	if t.Dark {
		return &darkPalette
	}
	return &lightPalette
}

// themeFrom makes the theme of the widgets from the palette that goes with
// the system's theme, a copy of it that keeps what follows the desktop, as
// the size of text.
func themeFrom(system *ui.Theme) *ui.Theme {
	p := paletteOf(system)
	t := *system
	t.Background, t.Text, t.TextMuted, t.Border = p.Background, p.Foreground, p.MutedForeground, p.Border
	t.Surface, t.SurfaceHover, t.SurfacePressed = p.Secondary, p.Accent, p.Accent
	t.Accent, t.AccentHover, t.AccentPressed, t.AccentText = p.Primary, p.Primary.Alpha(0.9), p.Primary.Alpha(0.8), p.PrimaryForeground
	t.Danger = p.Destructive
	// shadcn/ui has no tokens of these: Tailwind's green and amber
	t.Success, t.Warning = ui.Oklch(0.627, 0.194, 149.214), ui.Oklch(0.666, 0.179, 58.318)
	if t.Dark {
		t.Success, t.Warning = ui.Oklch(0.723, 0.219, 149.579), ui.Oklch(0.769, 0.188, 70.08)
	}
	// Tooltips as theirs: bg-foreground text-background
	t.Inverse, t.InverseText = p.Foreground, p.Background
	t.Selection, t.Focus, t.Scrollbar = p.Ring.Alpha(0.35), p.Ring.Alpha(0.5), p.Foreground.Alpha(0.25)
	// rounded-md: --radius, 0.625rem, less 2px
	t.Radius, t.Spacing = 8, 4
	return &t
}

// Sizes of text as Tailwind's, for a body of text-sm: the system's size,
// 13 on macOS where the web's is 14.
func textXS(t *ui.Theme) float32 { return t.FontSize - 2 }
func textLG(t *ui.Theme) float32 { return t.FontSize + 4 }
