// Package format writes counts, times, durations and paths as briefly as
// the window has room for, as the terminal writes them.
package format

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Count is a count in a few characters, as the terminal writes it: 950,
// 1.2k, 48.2k, 312k, 1.5M.
func Count(n int) string {
	switch {
	case n < 1000:
		return fmt.Sprint(n)
	case n < 1_000_000:
		return short(float64(n)/1000) + "k"
	default:
		return short(float64(n)/1_000_000) + "M"
	}
}

func short(n float64) string {
	if n < 100 {
		return strings.TrimSuffix(fmt.Sprintf("%.1f", n), ".0")
	}
	return fmt.Sprintf("%.0f", n)
}

// Ago says how long ago a time in milliseconds was, as briefly as a
// sidebar has room for.
func Ago(ms int64, now time.Time) string {
	d := now.Sub(time.UnixMilli(ms))
	switch {
	case d < time.Minute:
		return "now"
	case d < time.Hour:
		return fmt.Sprintf("%dm", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%dh", int(d.Hours()))
	case d < 7*24*time.Hour:
		return fmt.Sprintf("%dd", int(d.Hours()/24))
	}
	return time.UnixMilli(ms).Format("Jan 2")
}

// Duration is how long a call took, in milliseconds or seconds.
func Duration(ms int) string {
	if ms < 1000 {
		return fmt.Sprintf("%dms", ms)
	}
	return fmt.Sprintf("%.1fs", float64(ms)/1000)
}

// OneLine is s with its runs of spaces and lines as one space.
func OneLine(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

// ShortPath shows a folder by what tells it apart, its end: the home folder
// as ~, and a long path cut at its start.
func ShortPath(path string) string {
	if home, err := os.UserHomeDir(); err == nil && home != "" && strings.HasPrefix(path, home) {
		path = "~" + strings.TrimPrefix(path, home)
	}
	const most = 48
	if len(path) <= most {
		return path
	}
	parts := strings.Split(path, string(filepath.Separator))
	shown := parts[len(parts)-1]
	for i := len(parts) - 2; i >= 0 && len(shown)+len(parts[i])+3 <= most; i-- {
		shown = parts[i] + string(filepath.Separator) + shown
	}
	return "…" + string(filepath.Separator) + shown
}
