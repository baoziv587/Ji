package app

import (
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/egoist/mygo/ui"

	"desktop/agent"
)

// files writes a picture of 1200 by 900 and a note in a folder of the
// test's own.
func files(t *testing.T) (shot, notes, dir string) {
	t.Helper()
	dir = t.TempDir()
	shot = filepath.Join(dir, "shot.png")
	notes = filepath.Join(dir, "notes.md")
	out, err := os.Create(shot)
	if err != nil {
		t.Fatal(err)
	}
	picture := image.NewRGBA(image.Rect(0, 0, 1200, 900))
	for y := range 900 {
		for x := range 1200 {
			picture.Set(x, y, color.RGBA{uint8(x / 5), uint8(y / 4), 160, 255})
		}
	}
	if err := png.Encode(out, picture); err != nil {
		t.Fatal(err)
	}
	if err := out.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(notes, []byte("# notes"), 0o600); err != nil {
		t.Fatal(err)
	}
	return shot, notes, dir
}

func TestAttachedFilesGoWithTheMessage(t *testing.T) {
	a, f := testApp()
	shot, notes, _ := files(t)
	a.ChooseFiles = func() ([]string, error) { return []string{shot, notes}, nil }
	tt := ui.NewTester(a.View, 1100, 700)

	if err := tt.Click("Attach files"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	view := a.views["a"]
	if len(view.files) != 2 || view.files[0].thumb == nil || view.files[1].thumb != nil {
		t.Fatalf("attached %+v", view.files)
	}
	if w, h := view.files[0].thumb.Size(); w != 149 || h != thumbPixels {
		t.Errorf("the thumbnail is %dx%d", w, h)
	}
	if !tt.HasText("notes.md") || !tt.HasText("MD · 7 B") {
		t.Errorf("the note does not show by its name and size: %q", tt.Texts())
	}

	if err := tt.Click("Send"); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(f.sent["a"], []string{""}) || !slices.Equal(f.files, []string{shot, notes}) {
		t.Errorf("sent %q with %q", f.sent["a"], f.files)
	}
	if len(view.files) != 0 {
		t.Errorf("the files stay attached after sending: %+v", view.files)
	}
}

func TestDroppedFilesAreAttachedAndTakenOff(t *testing.T) {
	a, f := testApp()
	shot, notes, dir := files(t)
	tt := ui.NewTester(a.View, 1100, 700)

	if !tt.DropFiles(700, 300, shot, notes, dir) {
		t.Fatal("the session does not take files dropped on it")
	}
	tt.Frame()
	view := a.views["a"]
	if got := len(
		view.files,
	); got != 2 ||
		!tt.HasText(filepath.Base(dir)+" is a folder: attach the files in it") {
		t.Fatalf("attached %d, %q", got, tt.Texts())
	}

	if err := tt.Click("Remove shot.png"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if err := tt.Click("Message"); err != nil {
		t.Fatal(err)
	}
	tt.Type("read this")
	tt.Key(0, ui.KeyEnter)
	if !slices.Equal(f.sent["a"], []string{"read this"}) ||
		!slices.Equal(f.files, []string{notes}) {
		t.Errorf("sent %q with %q", f.sent["a"], f.files)
	}
}

func TestACommandLeavesTheFilesForTheMessage(t *testing.T) {
	a, f := testApp()
	_, notes, _ := files(t)
	view := a.views["a"]
	a.attach(view, notes)
	view.draft = "/think off"

	a.send(view)

	if len(f.commands["a"]) != 1 || len(f.files) != 0 || len(view.files) != 1 {
		t.Errorf("commands %q, sent %q, attached %+v", f.commands["a"], f.files, view.files)
	}
}

func TestSentFilesShowInTheMessage(t *testing.T) {
	a, _ := testApp()
	a.views["a"].t.Apply(agent.Event{Type: "user", Text: "why?", Files: []string{"/tmp/trace.log"}})
	tt := ui.NewTester(a.View, 1100, 700)

	if !tt.HasText("trace.log") || !tt.HasText("LOG") || !tt.HasText("why?") {
		t.Errorf("texts %q", tt.Texts())
	}
}

func TestTheModeShowsUnderTheInputWithoutTheKeys(t *testing.T) {
	a, _ := testApp()
	tt := ui.NewTester(a.View, 1100, 700)

	for _, id := range []string{"a", "c"} {
		a.Select(id)
		tt.Frame()
		mode := modeNamed(a.views[id].t.State.Mode).name
		if !tt.HasText(mode) {
			t.Errorf("session %s does not show its mode, %s: %q", id, mode, tt.Texts())
		}
		if tt.HasText("switches") || tt.HasText("commands") {
			t.Errorf("session %s lists the keys while idle: %q", id, tt.Texts())
		}
	}
	if !tt.HasText("What should we build in web?") {
		t.Errorf("texts %q", tt.Texts())
	}
}

func TestASessionCanBeGivenFullAccess(t *testing.T) {
	a, f := testApp()
	a.Select("c")
	tt := ui.NewTester(a.View, 1100, 700)

	if err := tt.Click("Mode"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if !tt.HasText("Nothing waits for a yes.") {
		t.Fatalf("the menu does not say what each mode lets through: %q", tt.Texts())
	}
	if err := tt.Click("Full access"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()

	if f.modes != 1 || a.views["c"].t.State.Mode != "yolo" || !tt.HasText("Full access") {
		t.Errorf("modes %d, mode %q: %q", f.modes, a.views["c"].t.State.Mode, tt.Texts())
	}
}
