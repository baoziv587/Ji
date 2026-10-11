package app

// The inspector: a step of the work whole, at the right of the
// conversation, as a Mac app's inspector shows what is chosen.

import (
	"fmt"
	"strings"
	"time"

	"github.com/egoist/mygo/ui"

	"desktop/conversation"
	"desktop/format"
	"desktop/ui/components"
	"desktop/ui/icons"
)

// The inspector's width at least, and the conversation's beside it: with
// less room than both, the inspector covers the conversation.
const (
	inspectorMin    = 320
	conversationMin = 440
)

// panelMotion is how the inspector comes in from the right and goes back,
// and how the conversation gives it room.
var panelMotion = ui.ElementTransition{
	Duration: 320 * time.Millisecond,
	Ease:     components.EaseOutExpo,
	Colors:   true,
	Enter:    &ui.Motion{X: 32},
	Exit:     &ui.Motion{X: 32},
}

// inspector shows step s, the one chosen: on its bar how it went, which of the
// session's steps it is, and the buttons to the one before and after, to
// copy it and to close; under it, the step whole. Up and Down go through
// the steps while the text area does not take them, and Esc closes it.
func (a *App) inspector(c *ui.Context, view *sessionView, s *conversation.Item, covering bool, width float32) {
	t := c.Theme()
	p := components.PaletteOf(t)
	if s != view.inspectedLast {
		view.inspectedLast, view.inspectList = s, ui.ListState{}
	}

	pane := ui.Box(c.Key("inspector")).Shrink(0).Background(p.Card).BorderWidth(0, 0, 0, 1).BorderColor(p.Border).Transition(panelMotion)
	if covering {
		pane.Absolute().Top(0).Bottom(0).Left(0).Right(0)
	} else {
		pane.Width(width)
	}
	pane.Children(func() {
		// The step's lines come in again as another is chosen
		ui.Box(c.Key(fmt.Sprint("step:", s.Step))).Fill().Transition(ui.ElementTransition{
			Duration: 240 * time.Millisecond, Ease: components.EaseOutExpo, Enter: &ui.Motion{Y: 6},
		}).Children(func() {
			conversation.Inspect(c, &view.inspectList, &view.t, s).Fill().Padding(TitleBarHeight, 0, 24).ScrollbarInsets(TitleBarHeight, 0, 0)
		})
		a.inspectorBar(c, view, s, covering)

		if !covering {
			edge := ui.Box(c).Absolute().Left(-3).Top(0).Width(6).FillHeight().Cursor(ui.CursorResizeEW)
			a.resizing = edge.Pressed()
			if dx, _, ok := edge.Dragged(); ok && dx != 0 {
				a.Layout.Inspector = max(width-dx, inspectorMin)
			}
		}
	})

	switch {
	case c.Shortcut(0, ui.KeyEscape):
		a.closeInspector(view)
	case c.Shortcut(0, ui.KeyUp):
		a.inspectStep(view, s, -1)
	case c.Shortcut(0, ui.KeyDown):
		a.inspectStep(view, s, 1)
	}
}

func (a *App) inspectorBar(c *ui.Context, view *sessionView, s *conversation.Item, covering bool) {
	t := c.Theme()
	p := components.PaletteOf(t)
	steps := view.t.Steps
	ui.Row(c).Absolute().Top(0).Left(0).Right(0).Height(TitleBarHeight).Gap(8).Padding(0, 10, 0, 16).AlignItems(ui.Center).
		Material(a.bar()).DragWindow().Children(func() {
		if covering {
			if components.Button(c, "", components.ButtonStyle{Variant: components.Ghost, Size: components.SizeIconSmall, Icon: icons.ChevronLeft}).
				Label("Back to the Conversation").Tooltip("Back (Esc)").Margin(0, 0, 0, -6).Clicked() {
				a.closeInspector(view)
			}
		}
		ui.Box(c.Key(fmt.Sprint("mark:", s.Step, stepState(s)))).Size(16, 16).Shrink(0).Transition(components.Rise).Children(func() {
			stepMark(c, view, s)
		})
		name := "Thinking"
		if s.Tool != nil {
			name = s.Tool.Name
		}
		ui.Text(c, name).Font("monospace").FontWeight(600).SingleLine().Shrink(1)
		if s.Tool != nil && s.Tool.Done {
			ui.Text(c, format.Duration(s.Tool.MS)).Font("monospace").FontSize(components.TextXS(t)).TextColor(p.MutedForeground).FontFeatures("tnum").Shrink(0)
		}
		ui.Box(c).Grow(1).MinWidth(8)

		ui.Text(c, fmt.Sprintf("%d of %d", s.Step+1, len(steps))).FontSize(components.TextXS(t)).TextColor(p.MutedForeground).FontFeatures("tnum").Shrink(0).
			Margin(0, 4, 0, 0)
		ghost := components.ButtonStyle{Variant: components.Ghost, Size: components.SizeIconSmall}
		ghost.Icon, ghost.Disabled = icons.ChevronUp, s.Step == 0
		if components.Button(c, "", ghost).Label("Previous Step").Tooltip("Previous step (↑)").Clicked() {
			a.inspectStep(view, s, -1)
		}
		ghost.Icon, ghost.Disabled = icons.ChevronDown, s.Step == len(steps)-1
		if components.Button(c, "", ghost).Label("Next Step").Tooltip("Next step (↓)").Clicked() {
			a.inspectStep(view, s, 1)
		}

		ghost.Disabled = false
		view.copied.Button(c, ghost, func() string { return copyText(s) }).Tooltip(copyTip(s))
		ghost.Icon = icons.X
		if !covering && components.Button(c, "", ghost).Label("Close").Tooltip("Close (Esc)").Clicked() {
			a.closeInspector(view)
		}
	})
}

// stepMark is how a step went, as its line in the conversation says it.
func stepMark(c *ui.Context, view *sessionView, s *conversation.Item) {
	p := components.PaletteOf(c.Theme())
	switch stepState(s) {
	case "thinking":
		ui.Box(c).Size(8, 8).Margin(4).Radius(4).Background(p.Thinking)
	case "running":
		color := p.Primary
		if view.t.Asking != nil {
			color = p.Waiting
		}
		components.Spinner(c, "Running", 16, color)
	case "stopped":
		ui.Icon(c, icons.Square).FontSize(16).TextColor(p.MutedForeground).Label("Stopped")
	case "failed":
		ui.Icon(c, icons.X).FontSize(16).TextColor(p.Destructive).Label("Failed")
	default:
		ui.Icon(c, icons.Check).FontSize(16).TextColor(p.Success).Label("Succeeded")
	}
}

func stepState(s *conversation.Item) string {
	call := s.Tool
	switch {
	case call == nil:
		return "thinking"
	case !call.Done:
		return "running"
	case call.Stopped:
		return "stopped"
	case !call.OK:
		return "failed"
	}
	return "done"
}

func copyTip(s *conversation.Item) string {
	if s.Tool == nil {
		return "Copy the thinking"
	}
	if s.Tool.Edit {
		return "Copy the changes"
	}
	return "Copy the output"
}

// copyText is what Copy puts on the clipboard: the thinking, an edit's
// diff, or a call's output.
func copyText(s *conversation.Item) string {
	call := s.Tool
	switch {
	case call == nil:
		return s.Text
	case call.Edit:
		var out strings.Builder
		for _, line := range call.Diff {
			out.WriteString(line.Text)
			out.WriteByte('\n')
		}
		return out.String()
	}
	return call.Output
}

// inspectStep shows the step by from s, the one shown, keeping its line in
// view in the conversation.
func (a *App) inspectStep(view *sessionView, s *conversation.Item, by int) {
	steps := view.t.Steps
	i := s.Step + by
	if i < 0 || i >= len(steps) {
		return
	}
	view.t.Inspected = steps[i]
	view.list.ScrollIntoView(view.t.RowOf(steps[i].Block))
}

// closeInspector hides the inspector and gives the keys back to the input.
func (a *App) closeInspector(view *sessionView) {
	view.t.Inspected = nil
	view.refocus = true
}
