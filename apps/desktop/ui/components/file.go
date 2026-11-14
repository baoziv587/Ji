package components

// A file a message carries: a mark of its kind, read off its name.

import (
	"path/filepath"
	"strings"

	"github.com/egoist/mygo/ui"

	"desktop/ui/fileicons"
)

// FileExt is the file's extension as its mark shows it: "PDF", "" for none.
func FileExt(name string) string {
	return strings.ToUpper(strings.TrimPrefix(filepath.Ext(name), "."))
}

// FileMark is the file's icon, as Symbols draws its kind, on a quiet
// tile.
func FileMark(c *ui.Context, name string, size float32) ui.Element {
	p := PaletteOf(c.Theme())
	return ui.Box(c).
		Size(size, size).
		Shrink(0).
		Center().
		Radius(size/4).
		Background(p.Background).
		Border(1, p.Border).
		Children(func() {
			ui.Image(c, fileicons.For(name)).Size(size*0.6, size*0.6)
		})
}

// FileChip is a file by its mark and its name, with detail under the name
// when there is any, as its size.
func FileChip(c *ui.Context, path, detail string) ui.Element {
	t := c.Theme()
	p := PaletteOf(t)
	mark, pad := float32(24), float32(4)
	if detail != "" {
		mark, pad = 36, 8
	}
	chip := ui.Row(c).
		Gap(8).
		AlignItems(ui.Center).
		Padding(pad, 12, pad, pad).
		Radius(10).
		Background(p.Muted).
		Border(1, p.Border).
		MaxWidth(240).
		Shrink(0).
		Tooltip(path)
	return chip.Children(func() {
		FileMark(c, path, mark)
		ui.Column(c).Gap(1).Shrink(1).MinWidth(0).Children(func() {
			ui.Text(c, filepath.Base(path)).FontWeight(500).SingleLine().Shrink(1)
			if detail != "" {
				ui.Text(c, detail).
					FontSize(TextXS(t)).
					TextColor(p.MutedForeground).
					SingleLine()
			}
		})
	})
}
