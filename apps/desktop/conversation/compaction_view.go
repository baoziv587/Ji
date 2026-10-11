package conversation

import (
	"time"

	"github.com/egoist/mygo/ui"

	"desktop/format"
	"desktop/ui/components"
)

// squeeze is how long a light takes to run along a half of the seam while
// the history is summarized.
const squeeze = 1400 * time.Millisecond

// compaction is where the history became a summary: a seam across the
// conversation, what it held and what it holds now in the middle. While
// the summary is written, a light runs along each half into the middle,
// the history pressed together; the seam rests as the summary comes, and
// the sizes rise in where the words were.
func compaction(c *ui.Context, item *Item) {
	t := c.Theme()
	p := components.PaletteOf(t)
	running := item.After == 0
	// The status line's spinner still says it runs
	moving := running && !c.Preferences().ReduceMotion
	small := func(text string) ui.Element {
		return ui.Text(c, text).FontSize(components.TextXS(t)).TextColor(p.MutedForeground).SingleLine()
	}

	ui.Row(c).Height(20).Gap(12).AlignItems(ui.Center).Children(func() {
		seam(c, p, moving, false)
		if running {
			ui.Row(c.Key("compacting")).Shrink(0).Transition(components.Rise).Children(func() {
				small("Summarizing what came before")
			})
		} else {
			ui.Row(c.Key("compacted")).Gap(6).AlignItems(ui.Center).Shrink(0).Transition(components.Rise).Children(func() {
				small("Summarized above")
				small("·")
				small(format.Count(item.Before) + " → " + format.Count(item.After) + " tokens").Font("monospace").FontFeatures("tnum")
			})
		}
		seam(c, p, moving, true)
	})
}

// seam is a half of the compaction's seam, a hairline; moving, a light
// runs along it into the middle, on the left half from the left and on the
// right one from the right. It moves in the Draw, a step each half Tick:
// gliding the width of the conversation, it steps visibly at a Tick. Those
// frames paint again without building the view.
func seam(c *ui.Context, p *components.Palette, moving, right bool) {
	ui.Box(c).Grow(1).AlignSelf(ui.Stretch).Draw(func(pt *ui.Painter, r ui.Rect) {
		y := r.Y + r.H/2
		pt.Fill(ui.Rect{X: r.X, Y: y - 0.5, W: r.W, H: 1}, p.Border, 0)
		if !moving {
			return
		}

		pt.After(components.UntilHalfTick(pt.Now()))
		phase := float32(pt.Now().UnixMilli()%squeeze.Milliseconds()) / float32(squeeze.Milliseconds())
		// From past the outer end until it is gone into the middle, fading
		// as it nears it
		length := r.W * 0.35
		travel := ui.EaseInOut(phase) * (r.W + length)
		light := p.Primary.Alpha(min(1, (1-phase)*3))
		comet := ui.Rect{X: r.X - length + travel, Y: y - 0.75, W: length, H: 1.5}
		fade := ui.LinearGradient{From: light.Alpha(0), To: light, Angle: 90}
		if right {
			comet.X = r.X + r.W - travel
			fade.Angle = 270
		}
		pt.Clip(r, 0, func() { pt.FillGradient(comet, fade, 0.75) })
	})
}
