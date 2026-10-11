package components

import (
	"math"
	"time"

	"github.com/egoist/mygo/ui"
)

// EaseOutExpo leaves at once and comes to rest slowly, as a thing set
// down does: what panels and rows move by.
func EaseOutExpo(t float32) float32 {
	if t >= 1 {
		return 1
	}
	return 1 - float32(math.Pow(2, -10*float64(t)))
}

// Tick is how often what moves by itself is drawn again: a spinner's turn,
// and the deltas of the reply shown. At the display's own rate, 120 a
// second on a ProMotion screen, every frame paints the whole window again,
// for a mark 16 wide.
const Tick = time.Second / 30

// UntilTick is how long from now to the next Tick. Every caller counts from
// the same clock, so what they ask for comes in one frame.
func UntilTick(now time.Time) time.Duration {
	return Tick - time.Duration(now.UnixNano())%Tick
}

// Rise brings an element in from a little below as it appears, and sends
// it up and away as it goes: a line of text taking another's place.
var Rise = ui.ElementTransition{
	Duration: 260 * time.Millisecond,
	Ease:     EaseOutExpo,
	Colors:   true,
	Enter:    &ui.Motion{Y: 6},
	Exit:     &ui.Motion{Y: -6},
}

// Cascade brings the i-th of rows in from a little above, each a moment
// after the one before it, as a list unfolds.
func Cascade(i int) ui.ElementTransition {
	return ui.ElementTransition{
		Duration: time.Duration(200+28*min(i, 10)) * time.Millisecond,
		Ease:     EaseOutExpo,
		Colors:   true,
		Enter:    &ui.Motion{Y: -4},
	}
}
