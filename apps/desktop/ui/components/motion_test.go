package components

import (
	"testing"
	"time"
)

func TestHalfTicksMeetTheTicks(t *testing.T) {
	now := time.Unix(0, 0).Add(Tick / 4)
	if got := UntilHalfTick(now); got < Tick/4-time.Microsecond || got > Tick/4+time.Microsecond {
		t.Errorf("a quarter in, %v to the next half, want a quarter", got)
	}
	tick := now.Add(UntilTick(now))
	if half := now.Add(UntilHalfTick(now)); half.Add(UntilHalfTick(half)) != tick {
		t.Errorf("two half ticks from %v miss the tick at %v", now, tick)
	}
}
