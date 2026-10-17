package app

import (
	"context"
	"errors"
	"image/png"
	"os"
	"slices"
	"testing"
	"time"

	"github.com/egoist/mygo/ui"
)

// testOnboarding runs every step at once, on the test's goroutine, with a
// Find that finds node and steps that record what they did.
func testOnboarding(node string) (*Onboarding, *[]string) {
	var did []string
	o := NewOnboarding(func(fn func()) { fn() })
	o.async = func(fn func()) { fn() }
	o.Version, o.Where = "v24.21.0", "~/Library/Application Support/Ji Agent/runtime"
	o.Find = func() string { return node }
	o.Install = func(_ context.Context, progress func(done, total int64)) (string, error) {
		progress(50, 100)
		progress(100, 100)
		did = append(did, "installed")
		return "/runtime/bin/node", nil
	}
	o.Start = func(node string) (string, error) {
		did = append(did, "started on "+node)
		return "http://127.0.0.1:1", nil
	}
	o.Ready = func(url string) { did = append(did, "ready at "+url) }
	return o, &did
}

func TestOnboardingStartsOnTheNodeFound(t *testing.T) {
	o, did := testOnboarding("/opt/homebrew/bin/node")
	o.Begin()
	if want := []string{"started on /opt/homebrew/bin/node", "ready at http://127.0.0.1:1"}; !slices.Equal(*did, want) {
		t.Errorf("did %q, want %q", *did, want)
	}
}

func TestOnboardingInstallsNodeWhenThereIsNone(t *testing.T) {
	o, did := testOnboarding("")
	o.Begin()
	tt := ui.NewTester(o.View, 1100, 700)
	if !tt.HasText("Ji Agent needs Node.js") || len(*did) > 0 {
		t.Fatalf("shows %q, did %q: no Node.js asks before it installs one", tt.Texts(), *did)
	}

	if err := tt.Click("Install Node.js"); err != nil {
		t.Fatal(err)
	}
	if want := []string{"installed", "started on /runtime/bin/node", "ready at http://127.0.0.1:1"}; !slices.Equal(*did, want) {
		t.Errorf("did %q, want %q", *did, want)
	}
}

func TestOnboardingShowsTheDownload(t *testing.T) {
	o, _ := testOnboarding("")
	o.Begin()
	o.step, o.progress = downloading, download{13_225_000, 52_900_000, 4 * time.Second}
	tt := ui.NewTester(o.View, 1100, 700)
	if !tt.HasText("Installing Node.js v24.21.0") || !tt.HasText("25%") || !tt.HasText("13.2 of 52.9 MB · about 12 seconds left") {
		t.Errorf("shows %q", tt.Texts())
	}

	o.progress.done = o.progress.total
	tt.Frame()
	if !tt.HasText("Unpacking…") || !tt.HasText("100%") || tt.HasText("Cancel") {
		t.Errorf("shows %q: unpacking cannot be cancelled", tt.Texts())
	}
}

func TestRemainingGoesByTheSpeedSoFar(t *testing.T) {
	for _, c := range []struct {
		download
		want string
	}{
		{download{10, 100, 500 * time.Millisecond}, ""},
		{download{0, 100, 3 * time.Second}, ""},
		{download{50, 100, 3 * time.Second}, "a few seconds left"},
		{download{25, 100, 4 * time.Second}, "about 12 seconds left"},
		{download{10, 100, 20 * time.Second}, "about 3 min left"},
		{download{100, 100, 9 * time.Second}, ""},
	} {
		if got := c.remaining(); got != c.want {
			t.Errorf("%+v.remaining() = %q, want %q", c.download, got, c.want)
		}
	}
}

func TestOnboardingCancelledGoesBack(t *testing.T) {
	o, did := testOnboarding("")
	o.Install = func(ctx context.Context, _ func(done, total int64)) (string, error) {
		o.cancel()
		return "", ctx.Err()
	}
	o.Begin()
	tt := ui.NewTester(o.View, 1100, 700)
	if err := tt.Click("Install Node.js"); err != nil {
		t.Fatal(err)
	}
	if !tt.HasText("Ji Agent needs Node.js") || tt.HasText("Ji Agent could not start") || len(*did) > 0 {
		t.Errorf("shows %q, did %q: a cancelled install offers to install again", tt.Texts(), *did)
	}
}

func TestOnboardingTriesAgainWhatFailed(t *testing.T) {
	o, did := testOnboarding("/usr/local/bin/node")
	start := o.Start
	o.Start = func(node string) (string, error) {
		o.Start = start
		return "", errors.New("the agent exited before it listened")
	}
	o.Begin()
	tt := ui.NewTester(o.View, 1100, 700)
	if !tt.HasText("The agent did not start: the agent exited before it listened") {
		t.Fatalf("shows %q", tt.Texts())
	}

	if err := tt.Click("Try Again"); err != nil {
		t.Fatal(err)
	}
	if want := []string{"started on /usr/local/bin/node", "ready at http://127.0.0.1:1"}; !slices.Equal(*did, want) {
		t.Errorf("did %q, want %q: trying again starts the service on the Node.js found", *did, want)
	}
}

// SNAPSHOT=/tmp/onboarding.png go test ./app -run TestOnboardingSnapshot,
// with DARK=1 for dark, and STEP=downloading or unpacking for the download.
func TestOnboardingSnapshot(t *testing.T) {
	out := os.Getenv("SNAPSHOT")
	if out == "" {
		t.Skip("SNAPSHOT is not set")
	}
	o, _ := testOnboarding("")
	o.Begin()
	switch os.Getenv("STEP") {
	case "downloading":
		o.step, o.progress = downloading, download{21_400_000, 52_900_000, 3 * time.Second}
	case "unpacking":
		o.step, o.progress = downloading, download{done: 52_900_000, total: 52_900_000}
	}
	tt := ui.NewTester(o.View, 1180, 780)
	tt.SetDark(os.Getenv("DARK") == "1")
	// The bar glides to its value, and the sheen to the middle of its sweep
	tt.Advance(700 * time.Millisecond)
	tt.Frame()
	f, err := os.Create(out)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err := png.Encode(f, tt.Image()); err != nil {
		t.Fatal(err)
	}
}
