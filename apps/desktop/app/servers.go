package app

// The servers of the person's ssh config, which the sidebar lists in place
// of the sessions: one picked opens a terminal of the shown session's panel
// connected to it, as `ssh <alias>` does in a shell.

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/egoist/mygo/ui"

	"desktop/ui/components"
	"desktop/ui/icons"
)

// server is a Host of the ssh config: the alias ssh is run with, and where
// it goes, as the config says.
type server struct {
	alias, host, user, port string
}

// address is where the server goes: user@host, with the port when it is
// not ssh's own.
func (s server) address() string {
	host := s.host
	if host == "" {
		host = s.alias
	}
	if s.user != "" {
		host = s.user + "@" + host
	}
	if s.port != "" && s.port != "22" {
		host += ":" + s.port
	}
	return host
}

// set gives the server an option of the config's: as ssh does, the first
// value given is the one taken.
func (s *server) set(key, value string) {
	var field *string
	switch key {
	case "hostname":
		field = &s.host
	case "user":
		field = &s.user
	case "port":
		field = &s.port
	default:
		return
	}
	if *field == "" {
		*field = value
	}
}

// serversState is the sidebar's list of servers while it shows.
type serversState struct {
	open   bool
	search string
	list   []server
	err    string
}

// sshConfig is where the person's ssh config is: ~/.ssh/config.
func sshConfig() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".ssh", "config")
}

// readServers reads the hosts of the ssh config at path in its order, each
// name of a Host line its own, with the files it includes; patterns are no
// server to connect to, and no config is no servers.
func readServers(path string) ([]server, error) {
	r := serverReader{dir: filepath.Dir(path), seen: map[string]bool{}}
	if err := r.read(path); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return nil, err
	}
	return r.servers, nil
}

type serverReader struct {
	// dir is where the config is, which relative includes start from.
	dir     string
	seen    map[string]bool
	servers []server
}

func (r *serverReader) read(path string) error {
	if r.seen[path] {
		return nil
	}
	r.seen[path] = true
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	// The servers of the Host line read last, which its options go to
	var block []int
	scan := bufio.NewScanner(f)
	for scan.Scan() {
		key, value := option(scan.Text())
		switch key {
		case "host":
			block = nil
			for name := range strings.FieldsSeq(value) {
				name = strings.Trim(name, `"`)
				if strings.ContainsAny(name, "*?!") {
					continue
				}
				block = append(block, len(r.servers))
				r.servers = append(r.servers, server{alias: name})
			}
		case "match":
			block = nil
		case "include":
			for pattern := range strings.FieldsSeq(value) {
				r.include(pattern)
			}
		case "hostname", "user", "port":
			for _, i := range block {
				r.servers[i].set(key, strings.Trim(value, `"`))
			}
		}
	}
	return scan.Err()
}

// include reads the files a pattern names, relative to the config's
// folder; one that cannot be read is left out, as ssh leaves it.
func (r *serverReader) include(pattern string) {
	if rest, ok := strings.CutPrefix(pattern, "~/"); ok {
		home, err := os.UserHomeDir()
		if err != nil {
			return
		}
		pattern = filepath.Join(home, rest)
	} else if !filepath.IsAbs(pattern) {
		pattern = filepath.Join(r.dir, pattern)
	}
	paths, _ := filepath.Glob(pattern)
	slices.Sort(paths)
	for _, path := range paths {
		_ = r.read(path)
	}
}

// option is a line's keyword, lowered, and its value: "Key value" or
// "Key=value"; none for a comment or an empty line.
func option(line string) (string, string) {
	line = strings.TrimSpace(line)
	if line == "" || strings.HasPrefix(line, "#") {
		return "", ""
	}
	i := strings.IndexAny(line, " \t=")
	if i < 0 {
		return strings.ToLower(line), ""
	}
	value := strings.TrimLeft(line[i:], " \t")
	value = strings.TrimSpace(strings.TrimPrefix(value, "="))
	return strings.ToLower(line[:i]), value
}

// toggleServers shows the servers in the sidebar, read anew, or the
// sessions again; the settings give way to them.
func (a *App) toggleServers() {
	sv := &a.servers
	sv.open = !sv.open
	sv.search = ""
	if !sv.open {
		return
	}
	a.settingsOpen = false
	a.focusSearch = true
	a.loadServers()
}

// loadServers reads the servers of the ssh config anew, for the sidebar
// and the panel's picker alike.
func (a *App) loadServers() {
	sv := &a.servers
	path := a.SSHConfig
	a.async(func() {
		list, err := readServers(path)
		a.update(func() {
			sv.list, sv.err = list, ""
			if err != nil {
				sv.err = err.Error()
			}
		})
	})
}

// connect opens a terminal connected to the server in the panel of the
// session shown, or of a new one when none is; one open already is shown.
func (a *App) connect(sv server) {
	if _, ok := a.session(a.selected); !ok {
		a.NewSession("")
	}
	s, ok := a.session(a.selected)
	view := a.views[a.selected]
	if !ok || view == nil {
		return
	}
	view.t.Inspected = nil
	pn := &view.panel
	pn.hosts, pn.hostSearch = false, ""
	if open := pn.serverTab(sv.alias); open >= 0 {
		pn.open, pn.picking, pn.active = true, false, open
		pn.tabs[open].term.focus = true
		return
	}
	a.openTerminal(s, view, sv.alias)
}

// connected is whether the shown session's panel has a terminal of the
// server's.
func (a *App) connected(alias string) bool {
	view := a.views[a.selected]
	if view == nil {
		return false
	}
	return view.panel.serverTab(alias) >= 0
}

// serversNav is the sidebar while it lists the servers: a search over
// them, the way back to the sessions, and a row for each.
func (a *App) serversNav(c *ui.Context) {
	t := c.Theme()
	p := components.PaletteOf(t)
	sv := &a.servers
	a.sidebarBar(c, func() { a.sidebarToggle(c) })
	a.searchRow(c)

	ui.Row(c).Height(32).Padding(0, 10).Gap(4).AlignItems(ui.Center).Shrink(0).Children(func() {
		back := components.Button(c, "", components.ButtonStyle{
			Variant: components.Ghost,
			Size:    components.SizeIconExtraSmall,
			Icon:    icons.ChevronLeft,
		}).
			Label("Back to Sessions").
			Tooltip("Back to Sessions (Esc)").
			Shrink(0)
		if back.Clicked() {
			a.toggleServers()
		}
		ui.Text(c, "Servers").FontWeight(600).Grow(1)
		if len(sv.list) > 0 {
			ui.Text(c, fmt.Sprint(len(sv.list))).
				FontSize(components.TextXS(t)).
				TextColor(p.MutedForeground).
				FontFeatures("tnum").
				Padding(0, 8)
		}
	})

	ui.Scroll(c).Grow(1).Children(func() {
		ui.Column(c).Padding(2, 10).Gap(2).Children(func() {
			a.serverRows(c, sv.search)
		})
	})
}

// serverRows is a row for each server the search matches, or what stands
// in their place.
func (a *App) serverRows(c *ui.Context, search string) {
	t := c.Theme()
	p := components.PaletteOf(t)
	sv := &a.servers
	quiet := func(text string) ui.Element {
		return ui.Text(c, text).TextColor(p.MutedForeground).Padding(8)
	}
	switch {
	case sv.err != "":
		ui.Text(c, sv.err).TextColor(p.Destructive).Padding(8)
		return
	case len(sv.list) == 0:
		quiet("No hosts in ~/.ssh/config")
		if a.OpenInEditor != nil {
			open := components.Button(c, "Open config", components.ButtonStyle{
				Variant: components.Outline,
				Size:    components.SizeSmall,
			}).Margin(0, 8).AlignSelf(ui.Start)
			if open.Clicked() {
				path := a.SSHConfig
				a.call(func(context.Context) error { return a.OpenInEditor(path) })
			}
		}
		return
	}
	shown := 0
	for _, s := range sv.list {
		if !matchesServer(s, search) {
			continue
		}
		shown++
		a.serverRow(c.Key("server:"+s.alias), s)
	}
	if shown == 0 {
		quiet("No servers match")
	}
}

func matchesServer(s server, search string) bool {
	search = strings.ToLower(strings.TrimSpace(search))
	return search == "" ||
		strings.Contains(strings.ToLower(s.alias), search) ||
		strings.Contains(strings.ToLower(s.address()), search)
}

// serverRow is a server as the sidebar lists it: its monogram and alias,
// where it goes in quiet ink, and a dot while the panel is connected to it.
func (a *App) serverRow(c *ui.Context, s server) {
	t := c.Theme()
	p := components.PaletteOf(t)
	row := ui.ButtonBase(c).
		Height(32).
		Padding(0, 8).
		Gap(8).
		Radius(t.Radius).
		AlignItems(ui.Center).
		Shrink(0).
		FocusRing(false).
		Transition(components.ColorTransition).
		Label(s.alias).
		Tooltip("ssh " + s.alias)
	if row.Hovered() {
		row.Background(p.Accent.Alpha(0.6))
	}
	components.FocusRing(row, p, 1)
	row.Children(func() {
		monogram(c, s.alias)
		ui.Text(c, s.alias).FontWeight(500).SingleLine().Shrink(0).MaxWidth(140)
		// Said once when the alias is where it goes
		address := s.address()
		if address == s.alias {
			address = ""
		}
		ui.Text(c, address).
			FontSize(components.TextXS(t)).
			TextColor(p.MutedForeground).
			SingleLine().
			Shrink(1).
			Grow(1).
			MinWidth(0)
		if a.connected(s.alias) {
			ui.Box(c).
				Size(6, 6).
				Radius(3).
				Background(p.Success).
				Shrink(0).
				Label("Connected").
				Tooltip("Open in the panel")
		}
	})
	if row.Clicked() {
		a.connect(s)
	}
}
