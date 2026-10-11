package conversation

import (
	"github.com/egoist/mygo/ui"
	extast "github.com/yuin/goldmark/extension/ast"

	"desktop/ui/components"
	"desktop/ui/icons"
)

// reply draws the reply's text, selected across its blocks as one text.
func reply(c *ui.Context, it *Item) {
	blocks := it.md.blocks
	ui.Column(c).Selectable().Children(func() {
		for i := range blocks {
			markdownBlock(c.Key(i), &blocks[i])
		}
	})
}

// markdownBlock draws a block after the markers of the list items and the
// bars of the quotes it is in, with the room above it inside it, so that
// a quote's bar runs on from the block before.
func markdownBlock(c *ui.Context, b *mdBlock) {
	p := components.PaletteOf(c.Theme())
	ink := p.Foreground
	if len(b.in) == 0 {
		ui.Column(c).Padding(b.gap, 0, 0).Children(func() {
			markdownContent(c, b, ink)
		})
		return
	}
	ui.Row(c).AlignItems(ui.Stretch).Children(func() {
		for _, box := range b.in {
			if box.quote {
				ink = p.MutedForeground
				top := float32(0)
				if box.first {
					top = b.gap
				}
				ui.Box(c).Width(2).Shrink(0).Radius(1).Background(p.Border).Margin(top, 12, 0, 0)
				continue
			}
			ui.Row(c).Width(box.width).Shrink(0).Padding(b.gap, 8, 0, 0).Justify(ui.End).Unselectable().Children(func() {
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
		inline(c, b.runs, ink, th.FontSize).LineHeight(1.625)
	case mdHeading:
		size := th.FontSize
		switch b.level {
		case 1:
			size = components.TextLG(th)
		case 2:
			size = th.FontSize + 2
		}
		inline(c, b.runs, p.Foreground, size).FontSize(size).FontWeight(600).LineHeight(1.4)
	case mdCode:
		fencedWell(c, b.code)
	case mdRule:
		ui.Box(c).Height(1).Background(p.Border).Margin(8, 0)
	case mdTable:
		table(c, b.table, ink)
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
	check := ui.Row(c).Size(14, 14).Margin(4, 0, 0).Radius(4).Justify(ui.Center).AlignItems(ui.Center)
	if box.task == taskOpen {
		check.Border(1, p.MutedForeground.Alpha(0.6))
		return
	}
	check.Background(p.Primary).Children(func() {
		ui.Icon(c, icons.Check).FontSize(11).TextColor(p.PrimaryForeground).Label("Done")
	})
}

// inline draws runs as a paragraph; a link in it opens in the browser.
func inline(c *ui.Context, runs []mdRun, ink ui.Color, size float32) ui.Element {
	p := components.PaletteOf(c.Theme())
	links := false
	for _, r := range runs {
		links = links || r.style&styleLink != 0
	}
	if !links {
		return ui.RichText(c, spans(p, runs, size)...).TextColor(ink)
	}

	return ui.RichText(c).TextColor(ink).Children(func() {
		for i := 0; i < len(runs); {
			if r := runs[i : i+1]; r[0].style&styleLink != 0 {
				ui.Link(c, "", r[0].url).TextColor(p.Primary).Tooltip(r[0].url).Children(func() {
					ui.RichText(c, spans(p, r, size)...)
				})
				i++
				continue
			}
			end := i + 1
			for end < len(runs) && runs[end].style&styleLink == 0 {
				end++
			}
			ui.RichText(c, spans(p, runs[i:end], size)...)
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
		}
		if r.style&styleEmphasis != 0 {
			s.Italic = true
		}
		if r.style&styleStrike != 0 {
			s.Strikethrough, s.Color = true, p.MutedForeground
		}
		if r.style&styleCode != 0 {
			s.Font, s.Size, s.Background = "monospace", size-1, p.Muted
		}
		out[i] = s
	}
	return out
}

// table draws a table in a seam, its head on the muted fill and its
// columns as wide as they need within the room there is.
func table(c *ui.Context, t *mdRows, ink ui.Color) {
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

	ui.Box(c).AlignSelf(ui.Start).MinWidth(0).Border(1, p.Border).Radius(th.Radius).Clip().Children(func() {
		ui.Grid(c).ColumnTracks(tracks...).Children(func() {
			for r, row := range t.rows {
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
						if i < len(row) {
							runs = row[i]
						}
						text := inline(c, runs, ink, th.FontSize).LineHeight(1.5)
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
