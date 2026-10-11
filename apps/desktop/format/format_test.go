package format

import (
	"os"
	"testing"
	"time"
)

func TestShortPathKeepsTheFolderName(t *testing.T) {
	home, _ := os.UserHomeDir()
	for path, want := range map[string]string{
		"/code/web":             "/code/web",
		home + "/projects/shop": "~/projects/shop",
		"/private/tmp/claude-501/-Users-xiang-projects/scratchpad/verify/billing-api": "…/scratchpad/verify/billing-api",
	} {
		if got := ShortPath(path); got != want {
			t.Errorf("ShortPath(%q) = %q, want %q", path, got, want)
		}
	}
}

func TestAgoIsBrief(t *testing.T) {
	now := time.Date(2026, 10, 10, 12, 0, 0, 0, time.UTC)
	for _, c := range []struct {
		before time.Duration
		want   string
	}{{10 * time.Second, "now"}, {5 * time.Minute, "5m"}, {3 * time.Hour, "3h"}, {50 * time.Hour, "2d"}, {30 * 24 * time.Hour, "Sep 10"}} {
		if got := Ago(now.Add(-c.before).UnixMilli(), now); got != c.want {
			t.Errorf("%v ago: %q, want %q", c.before, got, c.want)
		}
	}
}

func TestCountIsShort(t *testing.T) {
	for n, want := range map[int]string{950: "950", 1200: "1.2k", 48213: "48.2k", 312_000: "312k", 1_500_000: "1.5M"} {
		if got := Count(n); got != want {
			t.Errorf("Count(%d) = %q, want %q", n, got, want)
		}
	}
}

func TestHeadKeepsWholeCharacters(t *testing.T) {
	for _, c := range []struct {
		s    string
		n    int
		want string
	}{
		{"hello", 10, "hello"},
		{"hello", 3, "hel"},
		{"写个页面", 4, "写"},
		{"写个页面", 6, "写个"},
	} {
		if got := Head(c.s, c.n); got != c.want {
			t.Errorf("Head(%q, %d) = %q, want %q", c.s, c.n, got, c.want)
		}
	}
}
