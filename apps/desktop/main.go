// Ji Agent: a native window for the coding agent's sessions. The agent runs
// as an HTTP service (apps/coding-agent/src/server.ts) that keeps each session
// in a JSONL log; this app starts it, or connects to one already running, and
// draws the sessions with MyGo's native UI (package app).
//
//	pnpm desktop                             # from the repository: works on the directory it is run from
//	go tool mygo dev                         # with live reload, working on this directory
//	go run . -root ~/code/project            # works on another project
//	go run . -server http://127.0.0.1:4317   # connects to a running service (pnpm agent-server)
//
// Each flag can also come from the environment, for `mygo dev`, which passes
// none: JI_AGENT_SERVER, JI_AGENT_ROOT, JI_AGENT_SESSIONS, JI_AGENT_MODEL,
// JI_AGENT_THINKING, JI_AGENT_SCRIPT and JI_AGENT_YOLO=1.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"log"
	"os"
	"path/filepath"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"

	"desktop/agent"
	"desktop/app"
	"desktop/server"
)

func main() {
	wd, _ := os.Getwd()
	// An app opened from the Finder starts in /, which is no project to work on
	if home, err := os.UserHomeDir(); err == nil && wd == "/" {
		wd = home
	}
	address := flag.String("server", os.Getenv("JI_AGENT_SERVER"), "address of a running agent service; started here when empty")
	// pnpm runs a script in the package's directory, and says in INIT_CWD where it was run from
	root := flag.String("root", envOr("JI_AGENT_ROOT", envOr("INIT_CWD", wd)), "where a new session works when no folder is chosen")
	sessions := flag.String("sessions", os.Getenv("JI_AGENT_SESSIONS"), "where the service keeps the sessions (default: ~/.ji/sessions)")
	model := flag.String("model", os.Getenv("JI_AGENT_MODEL"), "the model, provider/id (default: the service's)")
	thinking := flag.String("thinking", os.Getenv("JI_AGENT_THINKING"), "the thinking level (default: the service's)")
	script := flag.String("agent", os.Getenv("JI_AGENT_SCRIPT"), "path of apps/coding-agent/src/server.ts (default: found above this directory)")
	yolo := flag.Bool("yolo", os.Getenv("JI_AGENT_YOLO") == "1", "nothing waits for a yes")
	flag.Parse()

	url := *address
	var started *server.Server
	if url == "" {
		s, err := server.Start(server.Options{Script: *script, Root: *root, Sessions: *sessions, Model: *model, Thinking: *thinking, Yolo: *yolo})
		if err != nil {
			log.Fatal(err)
		}
		started, url = s, s.URL
	}

	ctx, cancel := context.WithCancel(context.Background())
	var a *app.App
	mygo.App.WhenReady(func() {
		var win *mygo.Window
		a = app.New(agent.NewClient(url), func(fn func()) { win.Update(fn) })
		l := loadLayout()
		a.SidebarSize, a.InspectorSize = l.Sidebar, l.Inspector
		a.Settings = loadSettings()
		a.SaveSettings = saveSettings
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
		mygo.App.SetMenu(mygo.NewMenu([]*mygo.MenuItem{
			{Role: mygo.RoleAppMenu, Submenu: []*mygo.MenuItem{
				{Role: mygo.RoleAbout},
				mygo.Separator(),
				{Label: "Settings…", Accelerator: "CmdOrCtrl+,", Click: func(*mygo.MenuItem, *mygo.Window) {
					win.Update(a.OpenSettings)
				}},
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
				{Label: "New Session", Accelerator: "CmdOrCtrl+N", Click: func(*mygo.MenuItem, *mygo.Window) {
					win.Update(func() { a.NewSession("") })
				}},
				{Label: "Open Folder…", Accelerator: "CmdOrCtrl+O", Click: func(*mygo.MenuItem, *mygo.Window) {
					win.Update(a.NewSessionInFolder)
				}},
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
			Content:        ui.View(a.View),
		})
		go a.Follow(ctx)
	})
	mygo.App.OnWillQuit(func(*mygo.QuitEvent) {
		cancel()
		if a != nil {
			saveLayout(layout{Sidebar: a.SidebarSize, Inspector: a.InspectorSize})
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
	var s app.Settings
	if b, err := os.ReadFile(configPath("settings.json")); err == nil {
		_ = json.Unmarshal(b, &s)
	}
	return s
}

func saveSettings(s app.Settings) { writeConfig("settings.json", s) }

// layout is what of the window's arrangement lasts from one run to the next;
// the window's own frame MyGo keeps (StateKey).
type layout struct {
	Sidebar   float32 `json:"sidebar"`
	Inspector float32 `json:"inspector"`
}

func loadLayout() layout {
	l := layout{Sidebar: 260, Inspector: 400}
	if b, err := os.ReadFile(configPath("layout.json")); err == nil {
		_ = json.Unmarshal(b, &l)
	}
	if l.Sidebar < 180 {
		l.Sidebar = 260
	}
	if l.Inspector < 320 {
		l.Inspector = 400
	}
	return l
}

func saveLayout(l layout) { writeConfig("layout.json", l) }

func envOr(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}
