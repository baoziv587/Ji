package app

// The files attached to the next message, chosen or dropped on the
// session: in the input, a picture as a thumbnail, any other file as the
// mark of its kind and its name, each with a button that takes it off.

import (
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"os"
	"path/filepath"
	"slices"

	"github.com/egoist/mygo/ui"
	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"

	"desktop/format"
	"desktop/ui/components"
	"desktop/ui/icons"
)

// thumbSize is how big a picture shows in the input, in DIPs.
const thumbSize = 56

// thumbPixels is the shorter side of a thumbnail: twice its size, for a
// Retina screen, which a photo of many megapixels is scaled down to once,
// off the main thread, so that only that much stays in memory.
const thumbPixels = 2 * thumbSize

// maxThumbSource is the most pixels a picture is decoded from for its
// thumbnail: decoding takes them all at once. A bigger one shows its mark.
const maxThumbSource = 50_000_000

// thumbSlots is how many pictures are decoded at once: each can take
// hundreds of megabytes while it is, and many are dropped together.
var thumbSlots = make(chan struct{}, 2)

type attachment struct {
	path string
	// Read off the main thread: the file's size, -1 until then, and a
	// picture's thumbnail.
	size  int64
	thumb *ui.Bitmap
}

// attach adds files to the next message, each once.
func (a *App) attach(view *sessionView, paths ...string) {
	for _, path := range paths {
		if fileIndex(view.files, path) >= 0 {
			continue
		}
		view.files = append(view.files, attachment{path: path, size: -1})
		a.async(func() {
			info, err := os.Stat(path)
			var thumb *image.RGBA
			if err == nil && info.Mode().IsRegular() && canThumbnail(path) {
				thumb = thumbnail(path)
			}
			a.update(func() {
				i := fileIndex(view.files, path)
				switch {
				case i < 0:
				case err == nil && info.IsDir():
					view.files = slices.Delete(view.files, i, i+1)
					a.toast = &toast{
						message: filepath.Base(path) + " is a folder: attach the files in it",
					}
				case err == nil:
					view.files[i].size = info.Size()
					if thumb != nil {
						view.files[i].thumb = ui.NewBitmap(thumb)
					}
				}
			})
		})
	}
}

// chooseFiles asks for files to attach to the next message.
func (a *App) chooseFiles(view *sessionView) {
	if a.ChooseFiles == nil {
		return
	}
	a.async(func() {
		paths, err := a.ChooseFiles()
		a.update(func() {
			if err != nil {
				a.toast = &toast{message: "Could not choose files: " + err.Error()}
				return
			}
			a.attach(view, paths...)
			view.refocus = true
		})
	})
}

func (a *App) detach(view *sessionView, path string) {
	if i := fileIndex(view.files, path); i >= 0 {
		view.files = slices.Delete(view.files, i, i+1)
	}
	view.refocus = true
}

// fileIndex is where path is among the files attached, -1 when it is not.
func fileIndex(files []attachment, path string) int {
	return slices.IndexFunc(files, func(f attachment) bool { return f.path == path })
}

// canThumbnail is whether the file is a picture of a kind decoded above.
func canThumbnail(path string) bool {
	switch components.FileExt(path) {
	case "PNG", "JPG", "JPEG", "GIF", "WEBP":
		return true
	}
	return false
}

// thumbnail is the picture at path scaled down to cover thumbPixels
// square, nil when it cannot be read or is too big to decode.
func thumbnail(path string) *image.RGBA {
	thumbSlots <- struct{}{}
	defer func() { <-thumbSlots }()

	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	config, _, err := image.DecodeConfig(f)
	if err != nil || config.Width*config.Height > maxThumbSource {
		return nil
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return nil
	}
	src, _, err := image.Decode(f)
	if err != nil {
		return nil
	}

	b := src.Bounds()
	scale := min(1, float64(thumbPixels)/float64(min(b.Dx(), b.Dy())))
	w, h := max(1, int(float64(b.Dx())*scale)), max(1, int(float64(b.Dy())*scale))
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, b, draw.Src, nil)
	return dst
}

// attachments is the files attached to the next message, over the text
// typed.
func (a *App) attachments(c *ui.Context, view *sessionView) {
	if len(view.files) == 0 {
		return
	}
	ui.Row(c).Wrap().Gap(8).Padding(4, 4, 2).Children(func() {
		for _, f := range view.files {
			a.attachmentTile(c.Key("file:"+f.path), view, f)
		}
	})
}

// attachmentTile is one file attached: the button that takes it off shows
// as the pointer is over it, or the keys reach the button.
func (a *App) attachmentTile(c *ui.Context, view *sessionView, f attachment) {
	t := c.Theme()
	p := components.PaletteOf(t)
	name := filepath.Base(f.path)
	tile := ui.Box(c).Shrink(0)
	hovered := tile.Hovered()
	tile.Children(func() {
		if f.thumb != nil {
			ui.Image(c, f.thumb).
				Size(thumbSize, thumbSize).
				Fit(ui.Cover).
				Radius(10).
				Border(1, p.Border).
				Label(name).
				Tooltip(f.path)
		} else {
			components.FileChip(c, f.path, fileDetail(f)).Height(thumbSize)
		}

		remove := ui.ButtonBase(c).
			Absolute().
			Top(-6).
			Right(-6).
			Size(20, 20).
			Center().
			Radius(999).
			Background(p.Foreground).
			FocusRing(false).
			Label("Remove " + name)
		components.FocusRing(remove, p, 0)
		if !hovered && !remove.FocusVisible() {
			remove.Opacity(0)
		}
		remove.Children(func() {
			ui.Icon(c, icons.X).FontSize(12).TextColor(p.Background)
		})
		if remove.Clicked() {
			a.detach(view, f.path)
		}
	})
}

// fileDetail is what is known of a file besides its name: its kind and
// its size, once read.
func fileDetail(f attachment) string {
	kind := components.FileExt(f.path)
	if kind == "" {
		kind = "File"
	}
	if f.size < 0 {
		return kind
	}
	return fmt.Sprintf("%s · %s", kind, format.Bytes(f.size))
}
