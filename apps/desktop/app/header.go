package app

import (
	"github.com/egoist/mygo/ui"

	"desktop/agent"
	"desktop/format"
	"desktop/ui/components"
	"desktop/ui/icons"
)

// header is the session's place, as a trail over a rule: its folder, then
// its title; the folder gives way first as the window narrows. At the
// right, what opens the folder elsewhere and what puts the session away.
func (a *App) header(c *ui.Context, s agent.Session, view *sessionView) {
	t := c.Theme()
	p := components.PaletteOf(t)
	st := view.t.State
	// The window's title bar, as tall as the sidebar's top, so the two read as one bar
	ui.Row(c).
		Absolute().
		Top(0).
		Left(0).
		Right(0).
		Height(TitleBarHeight).
		Gap(8).
		Padding(0, 10, 0, a.titleInset(c)).
		AlignItems(ui.Center).
		Material(a.bar(a.contentCover(c))).
		DragWindow().
		Children(func() {
			if a.Layout.SidebarHidden {
				a.sidebarToggle(c)
			}
			folder := a.folderTitle(s.Root)
			monogram(c, folder).Tooltip(s.Root)
			ui.Text(c, folder).
				TextColor(p.MutedForeground).
				SingleLine().
				Shrink(1000).
				MinWidth(24).
				Tooltip(format.ShortPath(s.Root))
			ui.Text(c, "/").TextColor(p.MutedForeground.Alpha(0.6)).Shrink(0)
			ui.Text(c, titleOf(s)).FontWeight(600).SingleLine().Shrink(1)
			ui.Box(c).Grow(1).MinWidth(8)
			if a.OpenInEditor != nil && !a.isMissing(s.Root) {
				if components.Button(c, "Open in VS Code", components.ButtonStyle{
					Variant: components.Ghost,
					Size:    components.SizeSmall,
					Icon:    icons.SquareArrowOutUpRight,
				}).
					Tooltip("Open " + format.ShortPath(s.Root) + " in VS Code").
					Shrink(0).
					Clicked() {
					a.openInEditor(s.Root)
				}
			}
			if s.Archived {
				if components.Button(c, "Reopen", components.ButtonStyle{
					Variant: components.Outline,
					Size:    components.SizeSmall,
					Icon:    icons.ArchiveRestore,
				}).
					Clicked() {
					a.unarchive(s.ID)
				}
				return
			}
			busy := st.Replying || len(st.Asking) > 0
			archive := components.Button(c, "", components.ButtonStyle{
				Variant:  components.Ghost,
				Size:     components.SizeIconSmall,
				Icon:     icons.Archive,
				Disabled: busy,
			}).
				Label("Settle")
			if busy {
				archive.Tooltip("Stop the reply before settling the session")
			} else {
				archive.Tooltip("Settle: move to Settled; nothing is deleted")
			}
			if archive.Clicked() {
				a.archive(s.ID, true)
			}
		})
}

// openInEditor opens root in VS Code, and says so if it cannot.
func (a *App) openInEditor(root string) {
	open := a.OpenInEditor
	a.async(func() {
		if err := open(root); err != nil {
			a.update(func() { a.toast = &toast{message: "Could not open VS Code: " + err.Error()} })
		}
	})
}
