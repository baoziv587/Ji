package app

import (
	"fmt"
	"strings"
	"time"

	"github.com/egoist/mygo/ui"

	"desktop/agent"
	"desktop/commands"
	"desktop/format"
	"desktop/ui/components"
)

// statusLine is the terminal's status line: what the reply does and for
// how long, the mode, what a yes allowed, the steers not yet delivered,
// which entry of the menu is chosen, then the keys that work now.
func (a *App) statusLine(c *ui.Context, s agent.Session, view *sessionView, entries []commands.Entry) {
	t := c.Theme()
	p := components.PaletteOf(t)
	st := view.t.State
	small := func(text string, color ui.Color) ui.Element { return barText(c, text, color) }
	ui.Row(c).Height(20).Gap(6).Padding(0, 4).AlignItems(ui.Center).Children(func() {
		var parts []func()
		switch {
		case a.link.problem != "":
			parts = append(parts, func() { small(a.link.problem, p.Destructive).Shrink(1) })
		case a.failure != "":
			parts = append(parts, func() { small(a.failure, p.Destructive).Selectable().Shrink(1) })
		}
		if label := view.t.Activity; label != "" && (st.Replying || view.t.Asking != nil) {
			parts = append(parts, func() {
				ui.Row(c).Gap(6).AlignItems(ui.Center).Shrink(1).Children(func() {
					spin := p.Primary
					if view.t.Asking != nil {
						spin = p.Waiting
					}
					components.Spinner(c, label, 12, spin)
					small(label, p.Foreground).Shrink(1)
					elapsed := time.Since(view.t.Since)
					figures(c, fmt.Sprintf("%ds", int(elapsed.Seconds())), p.MutedForeground)
					// The spinner turns without building the view, so the count asks for its next second
					c.After(time.Second - elapsed%time.Second)
				})
			})
		}
		if st.Mode != "" {
			parts = append(parts, func() {
				// Less careful than ask, so it stands out in the warning color
				color := p.MutedForeground
				if st.Mode != "ask" {
					color = p.Warning
				}
				mode := ui.ButtonBase(c).Padding(0, 4).Radius(4).FocusRing(false).Transition(components.ColorTransition).Label("Mode")
				if !canSwitchMode(s, st) {
					mode.Disabled(true)
				} else if mode.Hovered() {
					mode.Background(p.Accent)
				}
				components.FocusRing(mode, p, 0)
				mode.Children(func() { small(st.Mode, color).FontWeight(500) })
				switch st.Mode {
				case "ask":
					mode.Tooltip("Every command, file read and change waits for a yes. ⇧⇥ approves the folder's files.")
				case "auto":
					mode.Tooltip("Files inside the folder are approved; commands still wait for a yes. ⇧⇥ asks about all.")
				default:
					mode.Tooltip("Nothing waits for a yes, outside the folder too. Chosen when the service started.")
				}
				if mode.Clicked() {
					a.switchMode(view)
				}
			})
		}
		if st.Allowed != "" {
			parts = append(parts, func() { small(st.Allowed, p.Warning).Shrink(1) })
		}
		if st.Queued > 0 {
			parts = append(parts, func() { figures(c, fmt.Sprintf("%d queued", st.Queued), p.Info) })
		}
		if len(entries) > 0 {
			parts = append(parts, func() { figures(c, fmt.Sprintf("%d of %d", view.menu.Selected+1, len(entries)), p.MutedForeground) })
		}

		for i, part := range parts {
			if i > 0 {
				small("·", p.MutedForeground)
			}
			part()
		}

		ui.Box(c).Grow(1)
		for _, key := range keysOf(st, view, entries) {
			ui.Row(c).Gap(4).AlignItems(ui.Center).Shrink(0).Children(func() {
				components.Kbd(c, key[0])
				small(key[1], p.MutedForeground)
			})
		}
	})
}

// keysOf is the keys that work now, as the terminal's status line lists
// them.
func keysOf(st agent.State, view *sessionView, entries []commands.Entry) [][2]string {
	switch {
	case len(entries) > 0:
		return [][2]string{{"↑↓", "choose"}, {"tab", "completes"}, {"↵", "runs"}, {"esc", "closes"}}
	case view.t.Inspected != nil:
		return [][2]string{{"↑↓", "steps"}, {"esc", "closes"}}
	case view.t.Asking != nil && st.Replying:
		return [][2]string{{"esc", "stops"}}
	case st.Replying:
		return [][2]string{{"↵", "steers"}, {"esc", "stops"}}
	case st.Mode != "" && st.Mode != "yolo":
		return [][2]string{{"⇧⇥", "switches"}, {"/", "commands"}}
	default:
		return [][2]string{{"/", "commands"}}
	}
}

// usageLine is the terminal's usage line: the history's size against
// where it is compacted, then what the session has spent. Blank until the
// first call has ended.
func usageLine(c *ui.Context, u agent.UsageReading) {
	t := c.Theme()
	p := components.PaletteOf(t)
	ui.Row(c).Height(16).Gap(12).Padding(0, 4).AlignItems(ui.Center).Children(func() {
		if u.Calls == 0 {
			return
		}

		if ctx := u.Context; ctx != nil {
			estimate, color := "", p.MutedForeground
			if ctx.Estimated {
				estimate = "~"
			}
			switch {
			case float64(ctx.Tokens) >= float64(ctx.Limit)*0.9:
				color = p.Destructive
			case float64(ctx.Tokens) >= float64(ctx.Limit)*0.7:
				color = p.Warning
			}
			figures(c, fmt.Sprintf("ctx %s%s/%s", estimate, format.Count(ctx.Tokens), format.Count(ctx.Limit)), color).
				Tooltip("The history, against where it is compacted")
		}

		parts := []string{
			fmt.Sprintf("$%.4f", u.Cost),
			fmt.Sprintf("in %s · out %s", format.Count(u.Input), format.Count(u.Output)),
			fmt.Sprintf("cache %d%%", u.Cache),
		}
		if u.Speed > 0 {
			parts = append(parts, fmt.Sprintf("%.0f tok/s", u.Speed))
		}
		figures(c, strings.Join(parts, " · "), p.MutedForeground).Shrink(1)
	})
}

// barText is the small text of the status and usage lines, its digits
// tabular so a count that changes does not jiggle what follows it.
func barText(c *ui.Context, text string, color ui.Color) ui.Element {
	return ui.Text(c, text).FontSize(components.TextXS(c.Theme())).TextColor(color).FontFeatures("tnum").SingleLine()
}

// figures is bar text that measures something, in the monospace of the
// console's numbers.
func figures(c *ui.Context, text string, color ui.Color) ui.Element {
	return barText(c, text, color).Font("monospace")
}
