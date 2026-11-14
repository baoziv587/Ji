package components

// A file a message carries: a mark of its kind, read off its extension.

import (
	"path/filepath"
	"strings"

	"github.com/egoist/mygo/ui"

	"desktop/ui/icons"
)

// FileExt is the file's extension as its mark shows it: "PDF", "" for none.
func FileExt(name string) string {
	return strings.ToUpper(strings.TrimPrefix(filepath.Ext(name), "."))
}

// fileColor tells kinds of files apart by the palette's hues.
func fileColor(p *Palette, ext string) ui.Color {
	switch ext {
	case "PNG", "JPG", "JPEG", "GIF", "WEBP", "SVG", "HEIC", "BMP":
		return p.Info
	case "PDF":
		return p.Destructive
	case "MD", "TXT", "RTF", "DOC", "DOCX":
		return p.CodeString
	case "JSON", "YAML", "YML", "TOML", "CSV", "XML", "SQL":
		return p.CodeNumber
	case "ZIP", "TAR", "GZ", "TGZ", "7Z", "RAR":
		return p.Warning
	case "GO", "TS", "TSX", "JS", "JSX", "PY", "RS", "RB", "JAVA", "C", "H",
		"CPP", "SWIFT", "KT", "SH", "CSS", "HTML":
		return p.CodeType
	}
	return p.MutedForeground
}

// FileMark is the file's extension in the color of its kind, on a tile of
// it; a file without one, or with a long one, is a page.
func FileMark(c *ui.Context, name string, size float32) ui.Element {
	p := PaletteOf(c.Theme())
	ext := FileExt(name)
	color := fileColor(p, ext)
	tile := ui.Box(c).
		Size(size, size).
		Shrink(0).
		Center().
		Radius(size/4).
		Background(color.Alpha(0.14)).
		Border(1, color.Alpha(0.3))
	return tile.Children(func() {
		if ext == "" || len(ext) > 4 {
			ui.Icon(c, icons.File).FontSize(size / 2).TextColor(color)
			return
		}
		ui.Text(c, ext).
			FontSize(max(size*0.28, 9)).
			FontWeight(700).
			LetterSpacing(0.2).
			TextColor(color).
			SingleLine()
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
