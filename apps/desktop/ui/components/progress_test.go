package components

import (
	"testing"
	"time"

	"github.com/egoist/mygo/ui"
)

func TestProgressGlidesToItsValue(t *testing.T) {
	var b Progress
	value := 0.4
	tt := ui.NewTester(func(c *ui.Context) { b.Bar(c, "Downloading", value, false) }, 300, 40)
	if got := b.glide.at(tt.Now()); got != 0 {
		t.Errorf("starts at %v, not gliding up from 0", got)
	}

	tt.Advance(100 * time.Millisecond)
	if got := b.glide.at(tt.Now()); got <= 0 || got >= value {
		t.Errorf("at %v a moment in, want between 0 and %v", got, value)
	}

	tt.Advance(time.Second)
	if got := b.glide.at(tt.Now()); got != value {
		t.Errorf("at %v once settled, want %v", got, value)
	}

	value = 0.1
	tt.Frame()
	tt.Advance(time.Second)
	if got := b.glide.at(tt.Now()); got != value {
		t.Errorf("at %v after going back, want %v", got, value)
	}
}

func TestProgressWithLessMotionIsThereAtOnce(t *testing.T) {
	var b Progress
	value := 0.4
	tt := ui.NewTester(func(c *ui.Context) { b.Bar(c, "Downloading", value, false) }, 300, 40)
	tt.SetPreferences(ui.Preferences{ReduceMotion: true})

	value = 0.6
	tt.Frame()
	if got := b.glide.at(tt.Now()); got != value {
		t.Errorf("at %v with less motion, want %v at once", got, value)
	}
}
