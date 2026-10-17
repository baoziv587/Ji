// Ji Agent: a native window for the coding agent's sessions. The agent runs
// as an HTTP service (apps/coding-agent/src/server.ts) that keeps each session
// in a JSONL log; this app starts it, or connects to one already running, and
// draws the sessions with MyGo's native UI (package app).
//
//	pnpm desktop                             # from the repository: works on the
//	                                         # directory it is run from
//	pnpm desktop:build                       # the .app and .dmg, with the service bundled in
//	go tool mygo dev                         # with live reload, working on this directory
//	go run . -root ~/code/project            # works on another project
//	go run . -server http://127.0.0.1:4317   # connects to a running service (pnpm agent-server)
//	go run . -onboarding                     # installs Node.js as if there were none
//	                                         # (pnpm desktop:onboarding)
//
// The service runs on Node.js: Ji Agent's own once installed, else the
// system's when new enough. With neither, the window offers to install Ji
// Agent's own (package nodejs) before it starts the service.
//
// Each flag can also come from the environment, for `mygo dev`, which passes
// none: JI_AGENT_SERVER, JI_AGENT_ROOT, JI_AGENT_SESSIONS, JI_AGENT_MODEL,
// JI_AGENT_THINKING, JI_AGENT_SCRIPT, JI_AGENT_YOLO=1 and JI_AGENT_ONBOARDING=1.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"

	"desktop/agent"
	"desktop/app"
	"desktop/nodejs"
	"desktop/server"
	"desktop/ui/components"
)

func main() {
	wd, _ := os.Getwd()
	// An app opened from the Finder starts in /, which is no project to work on
	if home, err := os.UserHomeDir(); err == nil && wd == "/" {
		wd = home
	}
	address := flag.String(
		"server",
		os.Getenv("JI_AGENT_SERVER"),
		"address of a running agent service; started here when empty",
	)
	// pnpm runs a script in the package's directory, and says in INIT_CWD where it was run from
	root := flag.String(
		"root",
		envOr("JI_AGENT_ROOT", envOr("INIT_CWD", wd)),
		"where a new session works when no folder is chosen",
	)
	sessions := flag.String(
		"sessions",
		os.Getenv("JI_AGENT_SESSIONS"),
		"where the service keeps the sessions (default: ~/.ji/sessions)",
	)
	model := flag.String(
		"model",
		os.Getenv("JI_AGENT_MODEL"),
		"the model, provider/id (default: the service's)",
	)
	thinking := flag.String(
		"thinking",
		os.Getenv("JI_AGENT_THINKING"),
		"the thinking level (default: the service's)",
	)
	script := flag.String(
		"agent",
		os.Getenv("JI_AGENT_SCRIPT"),
		"path of apps/coding-agent/src/server.ts (default: found above this directory)",
	)
	yolo := flag.Bool("yolo", os.Getenv("JI_AGENT_YOLO") == "1", "nothing waits for a yes")

	// Shows the onboarding as if the computer had no Node.js, installing into a
	// directory of its own that is removed on quit
	onboarding := flag.Bool(
		"onboarding",
		os.Getenv("JI_AGENT_ONBOARDING") == "1",
		"go through the onboarding as if there were no Node.js",
	)
	flag.Parse()

	own := nodejs.Runtime{Dir: configPath("runtime"), Release: nodejs.Pinned}
	find := func() string {
		node, _ := nodejs.Find(own)
		return node
	}
	if *onboarding {
		dir, err := os.MkdirTemp("", "ji-agent-onboarding-")
		if err != nil {
			log.Fatal(err)
		}
		defer os.RemoveAll(dir)
		own.Dir, find = dir, func() string { return "" }
	}

	ctx, cancel := context.WithCancel(context.Background())
	settings := loadSettings()
	var a *app.App
	var started *server.Server

	mygo.App.WhenReady(func() {
		var win *mygo.Window
		update := func(fn func()) { win.Update(fn) }
		mygo.Theme.SetSource(themeSource(settings.Appearance))

		open := func(url string) {
			a = app.New(agent.NewClient(url), update)
			a.Layout = loadLayout()
			a.Settings = settings

			appearance := a.Settings.Appearance
			a.SaveSettings = func(s app.Settings) {
				// The window's material is light or dark as the app is, not as macOS
				// is; set off the frame being built, which a change of theme redraws,
				// and only when the appearance changes, not with every setting
				if s.Appearance != appearance {
					appearance = s.Appearance
					go mygo.Theme.SetSource(themeSource(s.Appearance))
				}
				saveSettings(s)
			}

			a.Quit = mygo.App.Quit
			a.ChooseFolder = func() (string, error) {
				paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{
					Parent:            win,
					Title:             "Choose a Project Folder",
					ButtonLabel:       "Start Session",
					Directory:         true,
					CreateDirectories: true,
				})
				if err != nil || len(paths) == 0 {
					return "", err
				}
				return paths[0], nil
			}

			go a.Follow(ctx)
			// Run from the source, a scheme's stylesheet shows as it is saved
			if dir := components.SchemesSource(); dir != "" {
				go func() {
					err := components.WatchSchemes(
						ctx,
						dir,
						func(schemes []*components.Scheme, err error) {
							win.Update(func() { a.SchemesChanged(schemes, err) })
						},
					)
					if err != nil {
						log.Print(err)
					}
				}()
			}
		}

		ob := app.NewOnboarding(update)
		ob.Settings = settings
		ob.Version, ob.Where = own.Release.Version, home(own.Dir)
		ob.Find, ob.Install = find, own.Install
		ob.Start = func(node string) (string, error) {
			s, err := server.Start(server.Options{
				Script:   *script,
				Bundled:  bundledAgent(),
				Node:     node,
				Root:     *root,
				Sessions: *sessions,
				Model:    *model,
				Thinking: *thinking,
				Yolo:     *yolo,
			})
			if err != nil {
				return "", err
			}
			// Quitting stops it, which happens on the main thread, as Ready does
			update(func() { started = s })
			return s.URL, nil
		}
		ob.Ready = open

		// Each item does nothing until the service runs
		whenOpen := func(fn func(*app.App)) func(*mygo.MenuItem, *mygo.Window) {
			return func(*mygo.MenuItem, *mygo.Window) {
				win.Update(func() {
					if a != nil {
						fn(a)
					}
				})
			}
		}
		mygo.App.SetMenu(mygo.NewMenu([]*mygo.MenuItem{
			{Role: mygo.RoleAppMenu, Submenu: []*mygo.MenuItem{
				{Role: mygo.RoleAbout},
				mygo.Separator(),
				{
					Label:       "Settings…",
					Accelerator: "CmdOrCtrl+,",
					Click:       whenOpen((*app.App).OpenSettings),
				},
				mygo.Separator(),
				{Role: mygo.RoleServices},
				mygo.Separator(),
				{Role: mygo.RoleHide},
				{Role: mygo.RoleHideOthers},
				{Role: mygo.RoleUnhide},
				mygo.Separator(),
				{Role: mygo.RoleQuit},
			}},
			{Label: "File", Submenu: []*mygo.MenuItem{
				{
					Label:       "New Session",
					Accelerator: "CmdOrCtrl+N",
					Click:       whenOpen(func(a *app.App) { a.NewSession("") }),
				},
				{
					Label:       "Open Folder…",
					Accelerator: "CmdOrCtrl+O",
					Click:       whenOpen((*app.App).NewSessionInFolder),
				},
				mygo.Separator(),
				{Role: mygo.RoleClose},
			}},
			{Role: mygo.RoleEditMenu},
			{Role: mygo.RoleViewMenu},
			{Role: mygo.RoleWindowMenu},
		}))

		win = mygo.NewWindow(mygo.WindowOptions{
			Title:     "Ji Agent",
			Width:     1180,
			Height:    780,
			MinWidth:  720,
			MinHeight: 460,
			StateKey:  "main",
			// The view draws the title bar under the traffic lights, over the
			// sidebar's material
			TitleBarStyle:  mygo.TitleBarHiddenInset,
			TitleBarHeight: app.TitleBarHeight,
			Vibrancy:       mygo.VibrancySidebar,
			Content: ui.View(func(c *ui.Context) {
				if a == nil {
					ob.View(c)
					return
				}
				a.View(c)
			}),
		})

		if *address != "" {
			open(*address)
			return
		}
		ob.Begin()
	})
	mygo.App.OnWillQuit(func(*mygo.QuitEvent) {
		cancel()
		if a != nil {
			writeConfig("layout.json", a.Layout)
		}
		started.Stop()
	})
	err := mygo.App.Run()
	cancel()
	started.Stop()
	if err != nil {
		log.Fatal(err)
	}
}

// home is path with the home directory as ~.
func home(path string) string {
	if dir, err := os.UserHomeDir(); err == nil {
		if rest, ok := strings.CutPrefix(path, dir); ok {
			return "~" + rest
		}
	}
	return path
}

func configPath(name string) string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(dir, "Ji Agent", name)
}

// writeConfig writes v as JSON to the config file of that name, or nothing
// when it cannot.
func writeConfig(name string, v any) {
	path := configPath(name)
	if path == "" {
		return
	}

	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	if os.MkdirAll(filepath.Dir(path), 0o755) != nil {
		return
	}
	_ = os.WriteFile(path, b, 0o644)
}

// loadSettings reads the settings kept, the defaults where a file is
// missing or unreadable.
func loadSettings() app.Settings {
	s := app.DefaultSettings
	if b, err := os.ReadFile(configPath("settings.json")); err == nil {
		_ = json.Unmarshal(b, &s)
	}
	return s
}

func saveSettings(s app.Settings) { writeConfig("settings.json", s) }

func themeSource(a components.Appearance) mygo.ThemeSource {
	switch a {
	case components.Light:
		return mygo.ThemeLight
	case components.Dark:
		return mygo.ThemeDark
	}
	return mygo.ThemeSystem
}

func loadLayout() app.Layout {
	l := app.DefaultLayout
	if b, err := os.ReadFile(configPath("layout.json")); err == nil {
		_ = json.Unmarshal(b, &l)
	}
	return l.Fit()
}

// bundledAgent is where `pnpm desktop:build` puts the service in the app.
func bundledAgent() string {
	dir, err := mygo.App.Path(mygo.PathResources)
	if err != nil {
		return ""
	}
	return filepath.Join(dir, "agent-server", "server.js")
}

func envOr(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}
