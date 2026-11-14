package app

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/egoist/mygo/plugins/terminal"
	"github.com/egoist/mygo/ui"
)

func writeConfig(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	for name, text := range files {
		path := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(text), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return filepath.Join(dir, "config")
}

// The servers are the config's hosts in its order, each name of a Host
// line its own, with what the files it includes add; patterns are none.
func TestReadServersListsTheConfigsHosts(t *testing.T) {
	path := writeConfig(t, map[string]string{
		"config": `# mine
Include conf.d/*

Host *
  User nobody

Host web1 web2
  HostName example.com
  User deploy
  User ignored
Host db
  HostName=10.0.0.5
  Port 2222
Match host db
  User other
Host !bad *.internal
`,
		"conf.d/work": "Host build\n\tHostName build.work\n\tPort 22\n",
	})

	got, err := readServers(path)
	if err != nil {
		t.Fatal(err)
	}
	want := []server{
		{alias: "build", host: "build.work", port: "22"},
		{alias: "web1", host: "example.com", user: "deploy"},
		{alias: "web2", host: "example.com", user: "deploy"},
		{alias: "db", host: "10.0.0.5", port: "2222"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("servers %+v,\nwant %+v", got, want)
	}
	var addresses []string
	for _, s := range got {
		addresses = append(addresses, s.address())
	}
	if want := []string{
		"build.work", "deploy@example.com", "deploy@example.com", "10.0.0.5:2222",
	}; !reflect.DeepEqual(addresses, want) {
		t.Errorf("addresses %q, want %q", addresses, want)
	}

	none, err := readServers(filepath.Join(t.TempDir(), "config"))
	if err != nil || len(none) != 0 {
		t.Errorf("no config: %v, %v", none, err)
	}
}

// The Servers button shows the config's hosts in place of the sessions;
// one picked opens a terminal of the panel running ssh to it, and picked
// again shows that one. Esc on an empty search goes back to the sessions.
func TestServersConnectInThePanel(t *testing.T) {
	if testing.Short() {
		t.Skip("starts a program, with Ghostty's library")
	}
	a, _ := testApp()
	a.SSHConfig = writeConfig(t, map[string]string{
		"config": "Host web1\n  HostName example.com\n  User deploy\nHost db\n  Port 2222\n",
	})
	var ran [][]string
	a.NewTerminal = func(o terminal.Options) (*terminal.Terminal, error) {
		ran = append(ran, o.Command)
		o.Command = []string{"/bin/cat"}
		return terminal.New(o)
	}
	tt := ui.NewTester(a.View, 1300, 800)
	defer a.views["a"].panel.close()

	if err := tt.Click("Servers"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	for _, text := range []string{"Servers", "web1", "deploy@example.com", "db:2222"} {
		if !tt.HasText(text) {
			t.Errorf("no %q in %q", text, tt.Texts())
		}
	}
	if tt.HasText("Add rate limits") {
		t.Error("the sessions show with the servers")
	}

	for range 2 {
		if err := tt.Click("web1"); err != nil {
			t.Fatal(err)
		}
		tt.Frame()
	}
	pn := &a.views["a"].panel
	if !reflect.DeepEqual(ran, [][]string{{"ssh", "web1"}}) || len(pn.tabs) != 1 ||
		!pn.open || pn.tabs[0].name() != "web1" || !a.connected("web1") {
		t.Fatalf("ran %q, tabs %d, open %v", ran, len(pn.tabs), pn.open)
	}
	if !a.servers.open {
		t.Error("the servers give way once one is connected to")
	}

	// The terminal has the keys once connected
	if err := tt.Click("Search servers"); err != nil {
		t.Fatal(err)
	}
	tt.Type("zzz")
	tt.Frame()
	if !tt.HasText("No servers match") {
		t.Errorf("searched: %q", tt.Texts())
	}
	tt.Key(0, ui.KeyEscape)
	tt.Key(0, ui.KeyEscape)
	tt.Frame()
	if a.servers.open || !tt.HasText("Add rate limits") {
		t.Errorf("open %v, texts %q: Esc goes back to the sessions", a.servers.open, tt.Texts())
	}
}

// The panel's picker opens SSH with S: the servers under a search, Enter
// connecting to the first it finds, in a tab of the panel.
func TestPanelPickerConnectsToAServer(t *testing.T) {
	if testing.Short() {
		t.Skip("starts a program, with Ghostty's library")
	}
	a, _ := testApp()
	a.SSHConfig = writeConfig(t, map[string]string{
		"config": "Host web1\n  HostName example.com\nHost db\n  Port 2222\n",
	})
	var ran [][]string
	a.NewTerminal = func(o terminal.Options) (*terminal.Terminal, error) {
		ran = append(ran, o.Command)
		o.Command = []string{"/bin/cat"}
		return terminal.New(o)
	}
	tt := ui.NewTester(a.View, 1300, 800)
	defer a.views["a"].panel.close()

	tt.Key(ui.Cmd, ui.KeyJ)
	tt.Frame()
	tt.Key(0, ui.KeyS)
	tt.Frame()
	tt.Frame()
	if !tt.HasText("Connect to a server") || !tt.HasText("web1") || !tt.HasText("db:2222") {
		t.Fatalf("texts %q", tt.Texts())
	}
	tt.Type("db")
	tt.Key(0, ui.KeyEnter)
	tt.Frame()

	pn := &a.views["a"].panel
	if !reflect.DeepEqual(ran, [][]string{{"ssh", "db"}}) || len(pn.tabs) != 1 ||
		pn.picking || pn.hosts {
		t.Fatalf("ran %q, tabs %d, picking %v", ran, len(pn.tabs), pn.picking)
	}
}

// The servers and the settings take the sessions' place in turn.
func TestServersAndSettingsTakeTurns(t *testing.T) {
	a, _ := testApp()
	a.SSHConfig = filepath.Join(t.TempDir(), "config")
	tt := ui.NewTester(a.View, 1100, 700)

	_ = tt.Click("Servers")
	tt.Frame()
	_ = tt.Click("Settings")
	tt.Frame()
	if !a.settingsOpen || a.servers.open {
		t.Fatalf("settings %v, servers %v", a.settingsOpen, a.servers.open)
	}
	_ = tt.Click("Servers")
	tt.Frame()
	if a.settingsOpen || !a.servers.open {
		t.Errorf("settings %v, servers %v", a.settingsOpen, a.servers.open)
	}
}

// With no hosts, the list says so and opens the config to add one.
func TestServersWithNoHostsOpenTheConfig(t *testing.T) {
	a, _ := testApp()
	a.SSHConfig = filepath.Join(t.TempDir(), "config")
	var opened []string
	a.OpenInEditor = func(path string) error {
		opened = append(opened, path)
		return nil
	}
	tt := ui.NewTester(a.View, 1100, 700)

	if err := tt.Click("Servers"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if !tt.HasText("No hosts in ~/.ssh/config") {
		t.Fatalf("texts %q", tt.Texts())
	}
	if err := tt.Click("Open config"); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(opened, []string{a.SSHConfig}) {
		t.Errorf("opened %q", opened)
	}
}
