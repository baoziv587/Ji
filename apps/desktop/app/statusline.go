package app

import (
	"fmt"
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
					mode.Tooltip("Nothing waits for a yes, outside the folder too. ⇧⇥ goes back to ask.")
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
	case st.Mode != "":
		return [][2]string{{"⇧⇥", "switches"}, {"/", "commands"}}
	default:
		return [][2]string{{"/", "commands"}}
	}
}

// usageGauge is the terminal's usage line, folded into how full the
// history is against where it is compacted, in the terminal's words under
// the pointer, what the session has spent and how much of the input the
// cache gave; pressed, it opens the rest. Blank until the first call has
// ended.
func usageGauge(c *ui.Context, u agent.UsageReading, open *bool, drain *components.Drain) {
	if u.Calls == 0 {
		return
	}
	t := c.Theme()
	p := components.PaletteOf(t)
	ctx := u.Context
	full, color := contextFill(p, ctx)

	trigger := ui.ButtonBase(c).Height(24).Padding(0, 6, 0, 4).Gap(6).Radius(6).AlignItems(ui.Center).Shrink(0).
		FocusRing(false).Transition(components.ColorTransition)
	if trigger.Hovered() || *open {
		trigger.Background(p.Accent)
	}
	components.FocusRing(trigger, p, 0)
	spent := fmt.Sprintf("%s, cache %d%%", cost(u.Cost), u.Cache)
	trigger.Children(func() {
		if ctx != nil {
			components.Gauge(c, "Context", full, 14, color, drain)
			figures(c, fmt.Sprintf("%s%d%%", estimated(ctx), int(full*100)), color)
			barText(c, "·", p.MutedForeground)
		}
		figures(c, cost(u.Cost), p.MutedForeground)
		barText(c, "·", p.MutedForeground)
		figures(c, fmt.Sprintf("cache %d%%", u.Cache), p.MutedForeground)
	})
	if ctx == nil {
		trigger.Label("Usage: " + spent)
	} else {
		trigger.Label(fmt.Sprintf("Usage: context %d%% used, %s", int(full*100), spent))
		if !*open {
			trigger.Tooltip(fmt.Sprintf("ctx %s%s/%s", estimated(ctx), format.Count(ctx.Tokens), format.Count(ctx.Limit)))
		}
	}
	if trigger.Clicked() {
		*open = !*open
	}

	ui.PopoverBase(c, trigger, open, func(panel ui.Element) {
		panel.Margin(4, 0, 0, 0).Padding(12).Gap(4).Width(240).Radius(t.Radius).Background(p.Popover).Border(1, p.Border).
			Shadow(0, 4, 6, -1, ui.RGBA(0, 0, 0, 0.1))
		if ctx != nil {
			ui.Row(c).Height(20).AlignItems(ui.Center).Children(func() {
				ui.Text(c, "Context").TextColor(p.Foreground).FontWeight(500).Grow(1)
				ui.Text(c, fmt.Sprintf("%s%s / %s", estimated(ctx), format.Count(ctx.Tokens), format.Count(ctx.Limit))).
					Font("monospace").FontSize(components.TextCode(t)).TextColor(p.Foreground).FontFeatures("tnum")
			})
			ui.Box(c).Height(4).Margin(4, 0).Draw(func(pt *ui.Painter, r ui.Rect) {
				pt.Fill(r, p.MutedForeground.Alpha(0.25), 2)
				if full > 0 {
					pt.Fill(ui.Rect{X: r.X, Y: r.Y, W: max(r.W*float32(full), r.H), H: r.H}, color, 2)
				}
			})
			hint := "Compacts at " + format.Count(ctx.Limit)
			if ctx.Estimated {
				hint = "Estimated since the last compaction"
			}
			barText(c, hint, p.MutedForeground)
			ui.Box(c).Height(1).Background(p.Border).Margin(8, 0)
		}

		rows := [][2]string{
			{"Cost", cost(u.Cost)},
			{"Input", format.Count(u.Input)},
			{"Output", format.Count(u.Output)},
			{"Cache hit", fmt.Sprintf("%d%%", u.Cache)},
		}
		if u.Speed > 0 {
			rows = append(rows, [2]string{"Speed", fmt.Sprintf("%.0f tok/s", u.Speed)})
		}
		for _, row := range rows {
			ui.Row(c).Height(20).AlignItems(ui.Center).Children(func() {
				ui.Text(c, row[0]).TextColor(p.MutedForeground).Grow(1)
				ui.Text(c, row[1]).Font("monospace").FontSize(components.TextCode(t)).TextColor(p.Foreground).FontFeatures("tnum")
			})
		}
	})
}

// contextFill is how full the history is, and its color: quiet, then the
// warning's past 70%, the destructive's past 90%.
func contextFill(p *components.Palette, ctx *agent.ContextSize) (float64, ui.Color) {
	if ctx == nil || ctx.Limit <= 0 {
		return 0, p.MutedForeground
	}
	full := min(float64(ctx.Tokens)/float64(ctx.Limit), 1)
	switch {
	case full >= 0.9:
		return full, p.Destructive
	case full >= 0.7:
		return full, p.Warning
	}
	return full, p.MutedForeground
}

// estimated is the terminal's mark of a size estimated since a compaction.
func estimated(ctx *agent.ContextSize) string {
	if ctx.Estimated {
		return "~"
	}
	return ""
}

// cost is dollars to the cent, a cost under one cent not shown as nothing.
func cost(dollars float64) string {
	if dollars > 0 && dollars < 0.01 {
		return "<$0.01"
	}
	return fmt.Sprintf("$%.2f", dollars)
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
