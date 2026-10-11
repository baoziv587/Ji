package app

// The window's glass: the surfaces something shows through, the desktop
// through the sidebar and the content scrolling under the title bars, and
// how much, as the Transparency setting chooses. The composer's pane is
// not among them: it stays as clear as it is, the draft on it legible.

import (
	"github.com/egoist/mygo/plugins/glass"
	"github.com/egoist/mygo/ui"
)

// The transparencies the slider snaps to: solid, as the window is with
// no material; standard, as it ships; and clear.
const (
	transparencySolid    = 0
	transparencyStandard = 50
	transparencyClear    = 100
)

var transparencyDetents = [...]float64{transparencySolid, transparencyStandard, transparencyClear}

// ramp is a value of a surface at each detent, linear between them.
type ramp struct{ solid, standard, clear float32 }

func (r ramp) at(transparency float64) float32 {
	t := float32(min(max(transparency, transparencySolid), transparencyClear) / transparencyStandard)
	if t <= 1 {
		return r.solid + (r.standard-r.solid)*t
	}
	return r.standard + (r.clear-r.standard)*(t-1)
}

// glasses are the surfaces the transparency reaches, each standard as it
// was before there was a setting: what covers what shows through them,
// and how much that blurs. A clearer bar blurs more, so that what scrolls
// under it never reads as its title.
var glasses = struct {
	sidebar   ramp // of the scheme's sidebar color over the window's material
	selection ramp // of the brand's tint under the chosen session
	bar       ramp // of the background over the content under a title bar
	barBlur   ramp // of the content under a title bar, in DIPs
}{
	sidebar:   ramp{1, 0.6, 0.3},
	selection: ramp{0.16, 0.16, 0.12},
	bar:       ramp{1, scrollEdgeCover, 0.55},
	barBlur:   ramp{scrollEdgeBlur, scrollEdgeBlur, 10},
}

// How much of the background macOS's hard scroll edge lays over the
// content, and how much it blurs it (glass.ScrollEdge).
const (
	scrollEdgeCover = 0.8245
	scrollEdgeBlur  = 6.4
)

// seeThrough is whether the sidebar shows the window's material: there is
// one, and the transparency is not solid, where the sidebar is as it is
// without one.
func (a *App) seeThrough(c *ui.Context) bool {
	return a.vibrant(c) && a.Settings.Transparency > transparencySolid
}

func (a *App) bar() ui.Material { return barGlass(a.Settings.Transparency) }

// barGlass is a title bar's material at a transparency: macOS's hard
// scroll edge where it is standard, more of the background laid over it
// toward solid, and toward clear less of it, toned as the edge tones it,
// over the content blurred more.
type barGlass float64

func (b barGlass) PaintMaterial(p *ui.Painter, box ui.Rect, radii [4]float32) {
	bg := p.Theme().Background
	cover := glasses.bar.at(float64(b))
	switch {
	case cover >= 1:
		p.Fill(box, bg, radii[0])
		hairline(p, box)
	case cover >= scrollEdgeCover:
		glass.ScrollEdge{Hard: true}.PaintMaterial(p, box, radii)
		p.Fill(box, bg.Alpha((cover-scrollEdgeCover)/(1-scrollEdgeCover)), radii[0])
	default:
		glass.Blur{Radius: glasses.barBlur.at(float64(b))}.PaintMaterial(p, box, radii)
		p.Fill(box, edgeToned(bg).Alpha(cover), radii[0])
		hairline(p, box)
	}
}

func (b barGlass) String() string { return "bar glass" }

// edgeToned is c desaturated and lightened as the hard scroll edge lays
// the background over the content, so that a bar keeps its color across
// the standard transparency.
func edgeToned(c ui.Color) ui.Color {
	const saturation, offset = 0.947, 0.03
	rgb := [3]float32{float32(c.R) / 255, float32(c.G) / 255, float32(c.B) / 255}
	l := 0.2126*rgb[0] + 0.7152*rgb[1] + 0.0722*rgb[2]
	for i := range rgb {
		rgb[i] = min(max(l+(rgb[i]-l)*saturation+offset, 0), 1)
	}
	return ui.RGBA(uint8(rgb[0]*255+0.5), uint8(rgb[1]*255+0.5), uint8(rgb[2]*255+0.5), 1)
}

// hairline is the line the hard scroll edge draws under a bar, half a DIP:
// black at 10% in light mode, white at 7% in dark mode.
func hairline(p *ui.Painter, box ui.Rect) {
	line := ui.RGBA(0, 0, 0, 0.1)
	if p.Theme().Dark {
		line = ui.RGBA(255, 255, 255, 0.07)
	}
	h := max(0.5, 1/p.Scale())
	p.Fill(ui.Rect{X: box.X, Y: box.Y + box.H, W: box.W, H: h}, line.Alpha(0.5/h), 0)
}
