package components

import (
	"time"

	"github.com/egoist/mygo/ui"
)

// Progress is shadcn/ui's Progress, kept by whoever shows it from frame to
// frame: the bar glides to each new value rather than jumping, as the
// download's few updates a second would make it.
type Progress struct{ glide Drain }

const (
	progressHeight = 8
	// sweep is how long a pass of the sheen or the sliding segment takes.
	sweep = 1400 * time.Millisecond
)

// Bar is a rounded track of the primary color at 20%, filled to value in
// the primary color, named by label. A negative value is work of unknown
// length: a segment slides along the track. Busy sweeps a sheen over the
// fill, for work still going on once the bar is full, such as unpacking
// what was downloaded.
func (b *Progress) Bar(c *ui.Context, label string, value float64, busy bool) ui.Element {
	p := PaletteOf(c.Theme())
	still := c.Preferences().ReduceMotion
	if value >= 0 {
		value = min(value, 1)
		b.toward(value, c.Now(), still)
	}
	radius := float32(progressHeight) / 2
	return ui.Box(c).Height(progressHeight).Radius(radius).Background(p.Primary.Alpha(0.2)).Clip().
		Role(ui.RoleProgress).Range(0, 1, value).Label(label).
		Draw(func(pt *ui.Painter, r ui.Rect) {
			phase := float32(
				pt.Now().UnixMilli()%sweep.Milliseconds(),
			) / float32(
				sweep.Milliseconds(),
			)
			if value < 0 {
				pt.AnimationFrame()
				w := r.W * 0.3
				pt.Fill(
					ui.Rect{X: r.X - w + (r.W+w)*phase, Y: r.Y, W: w, H: r.H},
					p.Primary,
					radius,
				)
				return
			}

			shown := b.glide.at(pt.Now())
			if shown != value {
				pt.AnimationFrame()
			}
			fill := ui.Rect{X: r.X, Y: r.Y, W: r.W * float32(shown), H: r.H}
			pt.Fill(fill, p.Primary, radius)

			if !busy || still {
				return
			}
			pt.AnimationFrame()
			w := r.W * 0.4
			sheen := p.PrimaryForeground.Alpha(0.35)
			pt.Clip(fill, radius, func() {
				pt.FillGradient(
					ui.Rect{X: r.X - w + (r.W+w)*phase, Y: r.Y, W: w, H: r.H},
					ui.LinearGradient{
						Angle: 90,
						Stops: []ui.GradientStop{
							{Color: sheen.Alpha(0), At: 0},
							{Color: sheen, At: 0.5},
							{Color: sheen.Alpha(0), At: 1},
						},
					},
					0,
				)
			})
		})
}

// toward starts the fill gliding from where it is now to value, either way,
// unlike a Gauge's, which rises at once; with less motion it is there at
// once.
func (b *Progress) toward(value float64, now time.Time, still bool) {
	g := &b.glide
	if value == g.to {
		return
	}
	from := g.at(now)
	if still {
		from = value
	}
	g.from, g.to, g.start = from, value, now
}
