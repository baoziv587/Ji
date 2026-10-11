package conversation

import (
	"fmt"
	"strings"
	"time"

	"github.com/egoist/mygo/ui"

	"desktop/syntax"
	"desktop/ui/components"
	"desktop/ui/icons"
)

// chunk is how many lines of a block of code one text takes: a text is
// laid out again whole when it changes, so a block that streams in has
// only its last lines laid out again.
const chunk = 32

// fencedWell is a block of code of the reply: on its head the language it
// is in and a Copy, then its lines, colored as each ends.
func fencedWell(c *ui.Context, code *fenced) {
	th := c.Theme()
	p := components.PaletteOf(th)
	ui.Column(c).Background(p.Muted).Radius(th.Radius).Padding(0, 0, 10).Children(func() {
		ui.Row(c).Height(32).Padding(0, 4, 0, 12).AlignItems(ui.Center).Unselectable().Children(func() {
			ui.Text(c, code.lang).Font("monospace").FontSize(components.TextXS(th)).TextColor(p.MutedForeground).Grow(1)
			copied := time.Since(code.copied) < 1500*time.Millisecond
			style := components.ButtonStyle{Variant: components.Ghost, Size: components.SizeIconSmall, Icon: icons.Copy}
			if copied {
				style.Icon = icons.Check
				c.After(1500*time.Millisecond - time.Since(code.copied))
			}
			b := components.Button(c, "", style).Label("Copy").Tooltip("Copy the code")
			b.TextColor(p.MutedForeground)
			if copied {
				b.TextColor(p.Success)
			}
			if b.Clicked() {
				c.WriteClipboard(strings.TrimSuffix(code.text, "\n"))
				code.copied = time.Now()
			}
		})

		for i, spans := range code.chunks(p) {
			ui.RichText(c.Key(i), spans...).Font("monospace").FontSize(components.TextXS(th)).LineHeight(1.5).Padding(0, 12)
		}
	})
}

// chunks are the block's lines in spans, chunk lines to a text: made again
// only as its lines change, a line ended or colored, not each frame, as a
// reply may hold many blocks.
func (code *fenced) chunks(p *components.Palette) [][]ui.Span {
	lines := code.block.Lines()
	if n := len(lines); n > 0 && lines[n-1] == nil {
		// The line break that ends the last line starts none
		lines = lines[:n-1]
	}
	if len(lines) == 0 {
		return nil
	}
	if code.spansOf.lines == &lines[0] && code.spansOf.n == len(lines) && code.spansOf.palette == p {
		return code.spans
	}

	code.spans = code.spans[:0]
	for i := 0; i < len(lines); i += chunk {
		var spans []ui.Span
		for k, line := range lines[i:min(i+chunk, len(lines))] {
			if k > 0 {
				spans = append(spans, ui.Span{Text: "\n"})
			}
			spans = appendCode(spans, p, line, [2]int{}, ui.Color{})
		}
		code.spans = append(code.spans, spans)
	}
	code.spansOf.lines, code.spansOf.n, code.spansOf.palette = &lines[0], len(lines), p
	return code.spans
}

// appendCode puts a line of code's spans in their colors at the end of
// spans; the part changed, if any, on mark.
func appendCode(spans []ui.Span, p *components.Palette, line syntax.Line, changed [2]int, mark ui.Color) []ui.Span {
	at := 0
	for _, s := range line {
		end := at + len(s.Text)
		// A span the changed part starts or ends in is cut there
		cuts := []int{at}
		for _, x := range changed {
			if changed != [2]int{} && x > at && x < end {
				cuts = append(cuts, x)
			}
		}
		cuts = append(cuts, end)
		for k := range len(cuts) - 1 {
			span := ui.Span{Text: s.Text[cuts[k]-at : cuts[k+1]-at], Color: codeColor(p, s.Kind)}
			if cuts[k] >= changed[0] && cuts[k] < changed[1] {
				span.Background = mark
			}
			spans = append(spans, span)
		}
		at = end
	}
	return spans
}

// codeColor is the color of code of kind; none, the text's, for plain.
func codeColor(p *components.Palette, kind syntax.Kind) ui.Color {
	switch kind {
	case syntax.Keyword:
		return p.CodeKeyword
	case syntax.String:
		return p.CodeString
	case syntax.Number:
		return p.CodeNumber
	case syntax.Type:
		return p.CodeType
	case syntax.Comment:
		return p.MutedForeground
	case syntax.Punctuation:
		return p.Foreground.Mix(p.MutedForeground, 0.5)
	}
	return ui.Color{}
}

// codeLine is a line of a diff or a command: its sign in its side's hue,
// then its code in color; or as it reads, in its kind's hue, before it is.
func codeLine(c *ui.Context, line DiffLine) ui.Element {
	th := c.Theme()
	p := components.PaletteOf(th)
	color, band := diffColors(th, line.Kind)
	if line.Code == nil {
		return ui.Text(c, line.Text).Font("monospace").FontSize(components.TextXS(th)).TextColor(color)
	}

	var spans []ui.Span
	if line.Kind == DiffAdded || line.Kind == DiffRemoved {
		spans = append(spans, ui.Span{Text: line.Text[:1], Color: color})
	}
	spans = appendCode(spans, p, line.Code.Lines()[line.At], line.Changed, band.Alpha(2.5))
	return ui.RichText(c, spans...).Font("monospace").FontSize(components.TextXS(th)).TextColor(p.Foreground)
}

// lineNumber is a line's number in the gutter of a well.
func lineNumber(c *ui.Context, n, digits int) {
	th := c.Theme()
	ui.Text(c, fmt.Sprint(n)).Font("monospace").FontSize(components.TextXS(th)).TextColor(components.PaletteOf(th).MutedForeground.Alpha(0.6)).
		FontFeatures("tnum").MinWidth(float32(digits) * 7).TextAlign(ui.End).Shrink(0).Unselectable()
}
