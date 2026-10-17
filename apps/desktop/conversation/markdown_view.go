package conversation

import (
	"strings"
	"unicode"

	"github.com/egoist/mygo/ui"
	extast "github.com/yuin/goldmark/extension/ast"

	"desktop/ui/components"
	"desktop/ui/icons"
)

// markdownBlock draws a block after the markers of the list items and the
// bars of the quotes it is in, with the room above it inside it, so that
// a quote's bar runs on from the block before.
func markdownBlock(c *ui.Context, b *mdBlock) {
	th := c.Theme()
	p := components.PaletteOf(th)
	ink := p.Foreground
	// Prose runs about 85 characters to a line at most, 43 of CJK; code
	// and tables take the whole column
	measure := float32(Width)
	if b.kind != mdCode && b.kind != mdTable {
		measure = 43 * th.FontSize
	}
	if len(b.in) == 0 {
		ui.Column(c).MaxWidth(measure).Padding(b.gap, 0, 0).Children(func() {
			markdownContent(c, b, ink)
		})
		return
	}
	ui.Row(c).MaxWidth(measure).AlignItems(ui.Stretch).Children(func() {
		for _, box := range b.in {
			if box.quote {
				ink = p.Quoted()
				top := float32(0)
				if box.first {
					top = b.gap
				}
				ui.Box(c).
					Width(2).
					Shrink(0).
					Radius(1).
					Background(p.MutedForeground.Alpha(0.5)).
					Margin(top, 12, 0, 0)
				continue
			}
			ui.Row(c).
				Width(box.width).
				Shrink(0).
				Padding(b.gap, 8, 0, 0).
				Justify(ui.End).
				Unselectable().
				Children(func() {
					if box.first {
						listMarker(c, box)
					}
				})
		}
		ui.Column(c).Grow(1).Shrink(1).MinWidth(0).Padding(b.gap, 0, 0).Children(func() {
			markdownContent(c, b, ink)
		})
	})
}

func markdownContent(c *ui.Context, b *mdBlock, ink ui.Color) {
	th := c.Theme()
	p := components.PaletteOf(th)
	switch b.kind {
	case mdParagraph:
		inline(c, b.runs, b.texts(p, th.FontSize)[0], ink).LineHeight(1.625)
	case mdHeading:
		size := th.FontSize
		switch b.level {
		case 1:
			size = th.FontSize + 7
		case 2:
			size = components.TextLG(th)
		case 3:
			size = th.FontSize + 2
		}
		inline(
			c,
			b.runs,
			b.texts(p, size)[0],
			p.Stressed(),
		).FontSize(size).
			FontWeight(600).
			LineHeight(1.4)
	case mdCode:
		fencedWell(c, b.code)
	case mdRule:
		ui.Box(c).Height(1).Background(p.Border).Margin(8, 0)
	case mdTable:
		table(c, b.table, b.texts(p, th.FontSize), ink)
	}
}

// listMarker is a list item's bullet or number, or its task's box, on its
// first line.
func listMarker(c *ui.Context, box mdBox) {
	p := components.PaletteOf(c.Theme())
	if box.task == noTask {
		ui.Text(c, box.marker).TextColor(p.MutedForeground).LineHeight(1.625).FontFeatures("tnum")
		return
	}
	check := ui.Row(c).
		Size(14, 14).
		Margin(4, 0, 0).
		Radius(4).
		Justify(ui.Center).
		AlignItems(ui.Center)
	if box.task == taskOpen {
		check.Border(1, p.MutedForeground.Alpha(0.6))
		return
	}
	check.Background(p.Primary).Children(func() {
		ui.Icon(c, icons.Check).FontSize(11).TextColor(p.PrimaryForeground).Label("Done")
	})
}

// texts are the block's runs in spans, or those of each cell of its table
// in order: made again only in another palette or size, not each frame.
func (b *mdBlock) texts(p *components.Palette, size float32) [][]ui.Span {
	if b.spans != nil && b.spansOf.palette == p && b.spansOf.size == size {
		return b.spans
	}
	b.spans = b.spans[:0]
	if b.table == nil {
		b.spans = append(b.spans, spans(p, b.runs, size))
	} else {
		for _, row := range b.table.rows {
			for _, cell := range row {
				b.spans = append(b.spans, spans(p, cell, size))
			}
		}
	}
	b.spansOf.palette, b.spansOf.size = p, size
	return b.spans
}

// inline draws runs, in their spans, as a paragraph; a link in it opens in
// the browser.
func inline(c *ui.Context, runs []mdRun, spans []ui.Span, ink ui.Color) ui.Element {
	p := components.PaletteOf(c.Theme())
	links := false
	for _, r := range runs {
		links = links || r.style&styleLink != 0
	}
	if !links {
		return ui.RichText(c, spans...).TextColor(ink)
	}

	return ui.RichText(c).TextColor(ink).Children(func() {
		for i := 0; i < len(runs); {
			if r := runs[i : i+1]; r[0].style&styleLink != 0 {
				link := ui.Link(c, "", r[0].url).TextColor(p.Link()).Tooltip(r[0].url)
				// A grey link is set off by a faint line, which the pointer
				// darkens
				if p.Grey() && !link.Hovered() {
					link.Underline().DecorationColor(p.MutedForeground.Alpha(0.5))
				}
				link.Children(func() {
					ui.RichText(c, spans[i:i+1]...)
				})
				i++
				continue
			}
			end := i + 1
			for end < len(runs) && runs[end].style&styleLink == 0 {
				end++
			}
			ui.RichText(c, spans[i:end]...)
			i = end
		}
	})
}

func spans(p *components.Palette, runs []mdRun, size float32) []ui.Span {
	out := make([]ui.Span, len(runs))
	for i, r := range runs {
		s := ui.Span{Text: r.text}
		if r.style&styleStrong != 0 {
			s.Weight = 600
			if r.style&styleLink == 0 {
				s.Color = p.Stressed()
			}
		}
		if r.style&styleEmphasis != 0 {
			s.Italic = true
		}
		if r.style&styleStrike != 0 {
			s.Strikethrough, s.Color = true, p.MutedForeground
		}
		if r.style&styleCode != 0 {
			s.Font, s.Size, s.Background = "monospace", size-1, p.CodeSpan()
			if r.style&styleLink == 0 {
				s.Color, s.Background = p.InlineCode(codeKind(r.text))
			}
		}
		out[i] = s
	}
	return out
}

// codeKind is what code in a sentence names, by its shape: a call where it
// has parentheses, words apart a command or a phrase, a path where it has a
// slash, a glob or a file's extension, a member where dots join names.
func codeKind(s string) components.CodeKind {
	switch {
	case strings.Contains(s, "("):
		return components.CodeCall
	case strings.ContainsAny(s, " \t"):
		return components.CodeWord
	case strings.ContainsAny(s, "/*") || strings.HasPrefix(s, "~") || isFile(s):
		return components.CodePath
	case isMember(s):
		return components.CodeCall
	}
	return components.CodeWord
}

// fileExtensions are the extensions that make a name with a dot a file's,
// not a member's, as cdp.js against Browser.close.
var fileExtensions = map[string]bool{
	"c":     true,
	"cc":    true,
	"cfg":   true,
	"cjs":   true,
	"conf":  true,
	"cpp":   true,
	"css":   true,
	"csv":   true,
	"env":   true,
	"go":    true,
	"h":     true,
	"hpp":   true,
	"html":  true,
	"ini":   true,
	"java":  true,
	"jpeg":  true,
	"jpg":   true,
	"js":    true,
	"json":  true,
	"jsx":   true,
	"kt":    true,
	"lock":  true,
	"log":   true,
	"md":    true,
	"mdx":   true,
	"mjs":   true,
	"mod":   true,
	"pdf":   true,
	"php":   true,
	"png":   true,
	"py":    true,
	"rb":    true,
	"rs":    true,
	"scss":  true,
	"sh":    true,
	"sql":   true,
	"sum":   true,
	"svg":   true,
	"swift": true,
	"toml":  true,
	"ts":    true,
	"tsx":   true,
	"txt":   true,
	"vue":   true,
	"xml":   true,
	"yaml":  true,
	"yml":   true,
	"zsh":   true,
}

func isFile(s string) bool {
	i := strings.LastIndexByte(s, '.')
	return i >= 0 && i < len(s)-1 && fileExtensions[strings.ToLower(s[i+1:])]
}

// isMember is whether s is names joined by dots, :: or ->.
func isMember(s string) bool {
	parts := strings.FieldsFunc(
		s,
		func(r rune) bool { return r == '.' || r == ':' || r == '-' || r == '>' },
	)
	if len(parts) < 2 || !strings.ContainsAny(s, ".:>") {
		return false
	}
	for _, part := range parts {
		for i, r := range part {
			if r != '_' && r != '$' && !unicode.IsLetter(r) && (i == 0 || !unicode.IsDigit(r)) {
				return false
			}
		}
	}
	return true
}

// table draws a table in a seam, its head on the muted fill and its
// columns as wide as they need within the room there is.
func table(c *ui.Context, t *mdRows, cells [][]ui.Span, ink ui.Color) {
	th := c.Theme()
	p := components.PaletteOf(th)
	columns := 0
	for _, row := range t.rows {
		columns = max(columns, len(row))
	}
	tracks := make([]ui.Track, columns)
	for i := range tracks {
		tracks[i] = ui.FitContent()
	}

	ui.Box(c).
		AlignSelf(ui.Start).
		MinWidth(0).
		Border(1, p.Border).
		Radius(th.Radius).
		Clip().
		Children(func() {
			ui.Grid(c).ColumnTracks(tracks...).Children(func() {
				k := 0
				for r, row := range t.rows {
					texts := cells[k : k+len(row)]
					k += len(row)
					for i := range columns {
						cell := ui.Column(c).MinWidth(0).Padding(6, 12)
						if r < len(t.rows)-1 {
							cell.BorderWidth(0, 0, 1, 0).BorderColor(p.Border)
						}
						if r == 0 {
							cell.Background(p.Muted)
						}
						cell.Children(func() {
							var runs []mdRun
							var spans []ui.Span
							if i < len(row) {
								runs, spans = row[i], texts[i]
							}
							text := inline(c, runs, spans, ink).LineHeight(1.5)
							if r == 0 {
								text.FontWeight(600)
							}
							if i < len(t.align) {
								switch t.align[i] {
								case extast.AlignRight:
									text.TextAlign(ui.End)
								case extast.AlignCenter:
									text.TextAlign(ui.Center)
								}
							}
						})
					}
				}
			})
		})
}
