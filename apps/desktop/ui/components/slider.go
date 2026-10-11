package components

import "github.com/egoist/mygo/ui"

// Slider is shadcn/ui's Slider setting value between lo and hi: a track
// filled up to a round thumb. Dragged, it snaps to a detent, ticked under
// the track, once within a twenty-fifth of the range of it, and stops
// anywhere between; the arrows move it freely. Pressed on the element
// returned tells whether it is held.
func Slider(c *ui.Context, value *float64, lo, hi float64, detents ...float64) ui.Element {
	t := c.Theme()
	p := PaletteOf(t)
	const knob = 16

	var s ui.Element
	box := ui.Box(c)
	box.Children(func() {
		// The slider sets where the pointer has the value, which shows and is
		// set snapped: snapping the value it sets would fight the pointer,
		// which sets it again on every frame the slider is held
		at := ui.Local(box, sliderKey{}, func() float64 { return *value })
		s = ui.SliderBase(c, at, lo, hi).Height(knob + 8).PaddingX(knob / 2).FocusRing(false)
		held, changed := s.Pressed(), s.Changed()
		switch {
		case changed && held:
			*value = snap(*at, (hi-lo)/25, detents)
		case changed:
			*value = *at
		case !held:
			*at = *value
		}

		hovered, focused := s.Hovered() || held, s.FocusVisible()
		s.Draw(func(paint *ui.Painter, r ui.Rect) {
			left, width := r.X+knob/2, r.W-knob
			along := func(v float64) float32 { return left + width*float32((v-lo)/(hi-lo)) }
			for _, d := range detents {
				paint.Fill(ui.Rect{X: along(d) - 0.5, Y: r.Y + knob + 3, W: 1, H: 4}, p.MutedForeground.Alpha(0.6), 0)
			}

			x, mid := along(*value), r.Y+knob/2
			paint.Fill(ui.Rect{X: left, Y: mid - 2, W: width, H: 4}, p.Input, 2)
			paint.Fill(ui.Rect{X: left, Y: mid - 2, W: x - left, H: 4}, p.Primary, 2)

			thumb := ui.Rect{X: x - knob/2, Y: r.Y, W: knob, H: knob}
			switch {
			case focused:
				paint.Shadow(thumb, knob/2, 0, 0, 0, 3, p.Ring.Alpha(0.25))
			case hovered:
				paint.Shadow(thumb, knob/2, 0, 0, 0, 3, p.Ring.Alpha(0.15))
			}
			paint.Shadow(thumb, knob/2, 0, 1, 3, 0, ui.Oklch(0, 0, 0).Alpha(0.1))
			paint.Fill(thumb, p.Background, knob/2)
			paint.Stroke(thumb, p.Primary, knob/2, 1)
		})
	})
	return s
}

type sliderKey struct{}

func snap(v, near float64, detents []float64) float64 {
	for _, d := range detents {
		if v > d-near && v < d+near {
			return d
		}
	}
	return v
}
