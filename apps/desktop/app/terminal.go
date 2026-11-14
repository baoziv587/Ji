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
	// host is the server of the ssh config the terminal is connected to,
	// none for the user's shell.
	host string
	// What the shell calls itself, as it sets the title, and the theme the
	// terminal's colors were taken from.
	title string
	look  *ui.Theme
	// Whether the terminal takes the keys as it next shows, as it opens.
	focus bool
}

func (t *terminalSurface) name() string {
	if t.host != "" {
		return t.host
	}
	if t.title != "" {
		return t.title
	}
	return "Terminal"
}

func (t *terminalSurface) close() {
	t.term.Close()
}

// startTerminal starts the user's shell in the session's folder, or ssh
// connected to host; the program's exit closes its tab, but for ssh's own
// failure, which the tab is left to tell.
func (a *App) startTerminal(
	s agent.Session,
	view *sessionView,
	tab *surface,
	host string,
) (*terminalSurface, error) {
	surface := &terminalSurface{host: host, focus: true}
	options := terminal.Options{
		Dir:         s.Root,
		Transparent: true,
		Padding:     terminal.Padding{X: 12, Y: 8},
		OnTitle: func(title string) {
			a.update(func() { surface.title = title })
		},
		OnExit: func(code int) {
			if host != "" && code == sshFailed {
				a.update(func() { surface.term.Feed([]byte("\r\n[Not connected]\r\n")) })
				return
			}
			a.update(func() { a.closeSurface(view, tab) })
		},
	}
	if host != "" {
		options.Command = []string{"ssh", host}
		options.Dir = ""
	}
	term, err := a.NewTerminal(options)
	if err != nil {
		return nil, err
	}
	surface.term = term
	return surface, nil
}

// sshFailed is what ssh exits with when it fails itself, as it does when
// it cannot connect.
const sshFailed = 255

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
