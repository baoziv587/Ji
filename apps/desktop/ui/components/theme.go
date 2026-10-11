// Package components draws the window's controls on shadcn/ui's
// (new-york-v4) anatomy, in Ji's own palette: a graphite console, light
// and dark, divided by 1px seams, where color stands for state or action.
// The theme the widgets of MyGo draw with is made from the palette.
package components

import "github.com/egoist/mygo/ui"

// Palette holds shadcn/ui's tokens, by their names there, and the colors
// of what a session is doing. Hue is kept for meaning: blue is the brand,
// what to do and what runs; orange only what waits for the user; green
// done; red failed or destructive; violet thinking.
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

var lightPalette = Palette{
	Background:        ui.Hex("#F7F8FA"),
	Foreground:        ui.Hex("#1A1D24"),
	Card:              ui.Hex("#FFFFFF"),
	Popover:           ui.Hex("#FFFFFF"),
	Primary:           ui.Hex("#2E5BDA"),
	PrimaryForeground: ui.Hex("#FFFFFF"),
	Secondary:         ui.Hex("#ECEEF3"),
	Muted:             ui.Hex("#F0F2F5"),
	Accent:            ui.Hex("#E6E9EF"),
	MutedForeground:   ui.Hex("#5C6475"),
	Destructive:       ui.Hex("#C8324C"),
	Border:            ui.Hex("#DDE1E8"),
	Input:             ui.Hex("#CDD2DC"),
	Ring:              ui.Hex("#2E5BDA"),
	Sidebar:           ui.Hex("#EFF1F5"),
	SidebarAccent:     ui.Hex("#DCE5FA"),
	SidebarBorder:     ui.Hex("#DDE1E8"),
	Info:              ui.Hex("#0B72A8"),
	Waiting:           ui.Hex("#B8500C"),
	Success:           ui.Hex("#2B7F3A"),
	Thinking:          ui.Hex("#7347CC"),
	Warning:           ui.Hex("#8F6400"),
}

var darkPalette = Palette{
	Background:        ui.Hex("#16181D"),
	Foreground:        ui.Hex("#D6DAE2"),
	Card:              ui.Hex("#1E2128"),
	Popover:           ui.Hex("#1E2128"),
	Primary:           ui.Hex("#7AA2F7"),
	PrimaryForeground: ui.Hex("#0F1420"),
	Secondary:         ui.Hex("#252932"),
	Muted:             ui.Hex("#13151A"),
	Accent:            ui.Hex("#2A2E38"),
	MutedForeground:   ui.Hex("#8E96A7"),
	Destructive:       ui.Hex("#F7768E"),
	Border:            ui.Hex("#2A2E37"),
	Input:             ui.Hex("#343946"),
	Ring:              ui.Hex("#7AA2F7"),
	Sidebar:           ui.Hex("#1B1E24"),
	SidebarAccent:     ui.Hex("#24314D"),
	SidebarBorder:     ui.Hex("#2A2E37"),
	Info:              ui.Hex("#7DCFFF"),
	Waiting:           ui.Hex("#FF9E64"),
	Success:           ui.Hex("#9ECE6A"),
	Thinking:          ui.Hex("#BB9AF7"),
	Warning:           ui.Hex("#E0AF68"),
}

// PaletteOf is the palette that goes with a theme, light or dark.
func PaletteOf(t *ui.Theme) *Palette {
	if t.Dark {
		return &darkPalette
	}
	return &lightPalette
}

// Theme makes the theme of the widgets from the palette that goes with
// the system's theme, a copy of it that keeps what follows the desktop, as
// the size of text.
func Theme(system *ui.Theme) *ui.Theme {
	p := PaletteOf(system)
	t := *system
	t.Background, t.Text, t.TextMuted, t.Border = p.Background, p.Foreground, p.MutedForeground, p.Border
	t.Surface, t.SurfaceHover, t.SurfacePressed = p.Secondary, p.Accent, p.Accent
	t.Accent, t.AccentHover, t.AccentPressed, t.AccentText = p.Primary, p.Primary.Alpha(0.9), p.Primary.Alpha(0.8), p.PrimaryForeground
	t.Danger, t.Success, t.Warning = p.Destructive, p.Success, p.Warning
	// Tooltips as theirs: bg-foreground text-background
	t.Inverse, t.InverseText = p.Foreground, p.Background
	t.Selection, t.Focus, t.Scrollbar = p.Primary.Alpha(0.3), p.Ring.Alpha(0.5), p.Foreground.Alpha(0.25)
	// rounded-md: --radius, 0.625rem, less 2px
	t.Radius, t.Spacing = 8, 4
	return &t
}

// Sizes of text as Tailwind's, for a body of text-sm: the system's size,
// 13 on macOS where the web's is 14.
func TextXS(t *ui.Theme) float32 { return t.FontSize - 2 }
func TextLG(t *ui.Theme) float32 { return t.FontSize + 4 }
