package components

import (
	"testing"
	"time"
)

func TestDrainRunsDownAndJumpsUp(t *testing.T) {
	var d Drain
	start := time.Unix(0, 0)
	d.toward(0.9, start, false)
	if got := d.at(start); got != 0.9 {
		t.Fatalf("first value at %v, want it there at once", got)
	}

	d.toward(0.15, start, false)
	if mid := d.at(start.Add(drainTime / 4)); mid <= 0.15 || mid >= 0.9 {
		t.Errorf("down, at %v a quarter in, want between", mid)
	}
	if end := d.at(start.Add(drainTime)); end != 0.15 {
		t.Errorf("down, at %v at the end", end)
	}

	d.toward(0.2, start.Add(drainTime), false)
	if got := d.at(start.Add(drainTime)); got != 0.2 {
		t.Errorf("up, at %v, want there at once", got)
	}
	d.toward(0.1, start.Add(drainTime), true)
	if got := d.at(start.Add(drainTime)); got != 0.1 {
		t.Errorf("down with less motion, at %v, want there at once", got)
	}
}
