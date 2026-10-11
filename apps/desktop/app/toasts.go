package app

import (
	"github.com/egoist/mygo/ui"

	"desktop/ui/components"
)

// toasts shows the window's toasts as Sonner's, which shadcn/ui's are: at
// the bottom left, over the sidebar's empty end and no wider than it,
// clear of the input where the person types.
func toasts(c *ui.Context, width float32) {
	t := c.Theme()
	p := components.PaletteOf(t)
	ui.ToastViewportBase(c, func(viewport ui.Element, shown []ui.Toast) {
		viewport.Padding(12, 12, 60, 12).AlignItems(ui.Start).Gap(8)
		for _, item := range shown {
			toast := ui.ToastBase(c, item)
			toast.Root.Row().AlignSelf(ui.Start).AlignItems(ui.Center).Gap(12).Padding(12, 12, 12, 16).Radius(10).
				MaxWidth(max(width-24, 160)).Background(p.Popover).Border(1, p.Border).Shadow(0, 4, 12, 0, ui.RGBA(0, 0, 0, 0.1))
			toast.Root.Transition(ui.ElementTransition{Enter: &ui.Motion{Y: 8}, Exit: &ui.Motion{}})
			toast.Root.Children(func() {
				ui.Text(c, item.Title).FontWeight(500).TextColor(p.Foreground).Shrink(1).MaxLines(2)
				if item.Action != "" {
					action := toast.ActionButton().Height(24).Padding(0, 8).Radius(4).Background(p.Primary).
						FocusRing(false).Transition(components.ColorTransition)
					if action.Hovered() {
						action.Background(p.Primary.Alpha(0.9))
					}
					components.FocusRing(action, p, 0)
					action.Children(func() {
						ui.Text(c, item.Action).FontSize(components.TextXS(t)).FontWeight(500).TextColor(p.PrimaryForeground)
					})
				}
			})
		}
	})
}
