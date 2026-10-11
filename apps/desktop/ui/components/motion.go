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
