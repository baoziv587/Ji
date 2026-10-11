package app

import (
	"github.com/egoist/mygo/plugins/glass"
	"github.com/egoist/mygo/ui"

	"desktop/agent"
	"desktop/format"
	"desktop/ui/components"
	"desktop/ui/icons"
)

// header is the terminal's title, in one line over a rule: the session,
// the model and its settings muted after it, then its folder; what gives
// way first as the window narrows is the folder, then the title. Only the
// thinking level is chosen here: the rest is the session's.
func (a *App) header(c *ui.Context, s agent.Session, view *sessionView) {
	t := c.Theme()
	p := components.PaletteOf(t)
	st := view.t.State
	dot := func() ui.Element { return ui.Text(c, "·").TextColor(p.MutedForeground).Shrink(0) }
	// The window's title bar, as tall as the sidebar's top, so the two read as one bar
	ui.Row(c).Absolute().Top(0).Left(0).Right(0).Height(TitleBarHeight).Gap(6).Padding(0, 10, 0, 16).AlignItems(ui.Center).
		Material(glass.ScrollEdge{Hard: true}).DragWindow().Children(func() {
		ui.Text(c, titleOf(s)).FontWeight(600).SingleLine().Shrink(1)
		if st.Model != "" {
			dot()
			ui.Text(c, st.Model).TextColor(p.MutedForeground).SingleLine().Shrink(1).Tooltip("Model")
		}
		if len(st.ThinkingLevels) > 0 {
			dot()
			level := st.Thinking
			// Pulled in by its padding, so its text keeps the dots' spacing
			if components.InlineSelect(c, &level, st.ThinkingLevels, s.Archived).Margin(0, -2, 0, -6).Label("Thinking").Tooltip("Thinking level").Changed() {
				a.think(view, level)
			}
		}
		if st.Fast {
			dot()
			ui.Text(c, "fast").TextColor(p.MutedForeground).Shrink(0).Tooltip("OpenAI's priority tier, at about 2x the usage: /fast off")
		}
		// The folder shrinks far faster than the rest, so it gives way before
		// they are cut; and as the terminal drops it whole, it hides while the
		// last frame had no room for all of it, rather than show a stub
		before := dot()
		root := format.ShortPath(s.Root)
		folder := ui.Text(c, root).TextColor(p.MutedForeground).SingleLine().Shrink(1000).Tooltip(s.Root)
		if full, _ := c.MeasureText(0, ui.Span{Text: root, Size: t.FontSize}); folder.Bounds().W+0.5 < full {
			before.Opacity(0)
			folder.Opacity(0)
		}
		ui.Box(c).Grow(1).MinWidth(8)
		if s.Archived {
			if components.Button(c, "Unarchive", components.ButtonStyle{Variant: components.Outline, Size: components.SizeSmall, Icon: icons.ArchiveRestore}).Clicked() {
				a.unarchive(s.ID)
			}
			return
		}
		busy := st.Replying || len(st.Asking) > 0
		archive := components.Button(c, "", components.ButtonStyle{Variant: components.Ghost, Size: components.SizeIconSmall, Icon: icons.Archive, Disabled: busy}).Label("Archive")
		if busy {
			archive.Tooltip("Stop the reply before archiving the session")
		} else {
			archive.Tooltip("Archive: move to Archived; nothing is deleted")
		}
		if archive.Clicked() {
			a.archive(s.ID, true)
		}
	})
}
