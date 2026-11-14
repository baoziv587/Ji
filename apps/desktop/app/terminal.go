package app

// A terminal of the panel: the user's shell in the session's folder, in
// Ghostty's emulator (MyGo's terminal plugin), colored as the window is.

import (
	"fmt"

	"github.com/egoist/mygo/plugins/terminal"
	"github.com/egoist/mygo/ui"

	"desktop/agent"
	"desktop/ui/components"
)

type terminalSurface struct {
	term *terminal.Terminal
	// What the shell calls itself, as it sets the title, and the theme the
	// terminal's colors were taken from.
	title string
	look  *ui.Theme
	// Whether the terminal takes the keys as it next shows, as it opens.
	focus bool
}

func (t *terminalSurface) name() string {
	if t.title != "" {
		return t.title
	}
	return "Terminal"
}

func (t *terminalSurface) close() {
	t.term.Close()
}

// startTerminal starts the user's shell in the session's folder; the
// shell's exit closes its tab.
func (a *App) startTerminal(
	s agent.Session,
	view *sessionView,
	tab *surface,
) (*terminalSurface, error) {
	surface := &terminalSurface{focus: true}
	term, err := a.NewTerminal(terminal.Options{
		Dir:         s.Root,
		Transparent: true,
		Padding:     terminal.Padding{X: 12, Y: 8},
		OnTitle: func(title string) {
			a.update(func() { surface.title = title })
		},
		OnExit: func(int) {
			a.update(func() { a.closeSurface(view, tab) })
		},
	})
	if err != nil {
		return nil, err
	}
	surface.term = term
	return surface, nil
}

// terminalView shows the terminal, and is whether it has the keys.
func (a *App) terminalView(c *ui.Context, tab *surface) bool {
	surface := tab.term
	t := c.Theme()
	if surface.look != t {
		surface.look = t
		theme := terminalTheme(components.PaletteOf(t), t.Dark)
		surface.term.SetTheme(theme, theme)
	}
	view := terminal.View(c.Key(fmt.Sprint("terminal:", tab.id)), surface.term).Fill()
	if surface.focus {
		surface.focus = false
		view.Focus()
	}
	return view.FocusWithin()
}

// terminalTheme is the window's palette for the terminal: its text,
// cursor and selection; programs' 16 colors are those of VS Code.
func terminalTheme(p *components.Palette, dark bool) *terminal.Theme {
	base := terminal.LightTheme()
	if dark {
		base = terminal.DarkTheme()
	}
	theme := *base
	theme.Foreground, theme.Background = p.Foreground, p.Background
	theme.Cursor, theme.CursorText = p.Foreground, p.Background
	theme.Selection = p.Primary.Alpha(0.35)
	return &theme
}
