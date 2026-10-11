package components

import (
	"time"

	"github.com/egoist/mygo/ui"

	"desktop/ui/icons"
)

const copiedFor = 1500 * time.Millisecond

// Copied is when a Copy button was last pressed, which it answers with a
// check for a moment.
type Copied struct{ at time.Time }

// Recent is whether the check shows.
func (f *Copied) Recent() bool { return time.Since(f.at) < copiedFor }

// Button is an icon button in style that puts text on the clipboard. text
// is read only once pressed, as it may be long to make.
func (f *Copied) Button(c *ui.Context, style ButtonStyle, text func() string) ui.Element {
	p := PaletteOf(c.Theme())
	copied := f.Recent()

	style.Icon = icons.Copy
	if copied {
		style.Icon = icons.Check
		c.After(copiedFor - time.Since(f.at))
	}

	b := Button(c, "", style).Label("Copy")
	if copied {
		b.TextColor(p.Success)
	}
	if b.Clicked() {
		c.WriteClipboard(text())
		f.at = time.Now()
	}
	return b
}
