package conversation

import (
	"fmt"

	"github.com/egoist/mygo/ui"

	"desktop/format"
	"desktop/ui/components"
	"desktop/ui/icons"
)

// work draws the work between what the reply says: one line that says
// what it did, or what it does now as it runs, which opens to its steps,
// a line each on a thread; and under it, open or not, the files it
// changed and the calls that failed. A step clicked shows whole in the
// inspector.
func work(c *ui.Context, t *Transcript, w *Work) {
	ui.Column(c).Children(func() {
		parts := ui.CollapsibleBase(c, &w.Open)
		workLine(c, t, w, parts)

		// Always built, so that the steps coming into it come in, one after
		// another; it grows with them as it opens, and shrinks as it closes
		progress := parts.Progress()
		var steps ui.Element
		clip := ui.Column(c).Shrink(0).ClipY().Children(func() {
			steps = ui.Column(c).Shrink(0).Children(func() {
				if !w.Open && progress == 0 {
					return
				}
				for i, s := range w.Steps {
					step(c.Key(s.Step), t, s, i, i == len(w.Steps)-1)
				}
			})
		})
		if progress < 1 {
			clip.Height(progress * steps.Bounds().H)
		}

		for _, f := range w.Files {
			fileLine(c.Key("file:"+f.Path), t, f)
		}
		for _, s := range w.Failed {
			failedLine(c.Key(s.Step), t, s)
		}
	})
}

// workLine is the work's line, the trigger that opens it: its state, what
// it did or does, how long it took, and the arrow.
func workLine(c *ui.Context, t *Transcript, w *Work, parts ui.CollapsibleParts) {
	th := c.Theme()
	p := components.PaletteOf(th)
	outcome := w.Outcome()
	line := parts.Trigger.Height(28).Gap(8).Padding(0, 8).Margin(0, -8).Radius(6).AlignItems(ui.Center).
		FocusRing(false).TextColor(p.MutedForeground).Transition(components.ColorTransition)
	hovered := line.Hovered()
	if hovered {
		line.Background(p.Accent.Alpha(0.6)).TextColor(p.Foreground)
	}
	components.FocusRing(line, p, 0)

	line.Children(func() {
		// The state, a new mark as it changes, so the check comes in as the
		// spinner goes
		ui.Box(c.Key("state:"+outcome)).Size(16, 16).Shrink(0).Transition(components.Rise).Children(func() {
			switch outcome {
			case "running":
				color := p.Primary
				if t.Asking != nil {
					color = p.Waiting
				}
				components.Spinner(c, "Running", 16, color)
			case "failed":
				ui.Icon(c, icons.X).FontSize(16).TextColor(p.Destructive).Label("Failed")
			case "stopped":
				ui.Icon(c, icons.Square).FontSize(16).TextColor(p.MutedForeground).Label("Stopped")
			default:
				ui.Icon(c, icons.Check).FontSize(16).TextColor(p.Success).Label("Done")
			}
		})

		// What it does now, each step taking the last one's place, or what
		// it did, once it rests
		ui.Row(c).Grow(1).Shrink(1).MinWidth(0).Gap(8).AlignItems(ui.Center).ClipX().Children(func() {
			now := w.Current
			if now == nil {
				ui.Text(c.Key("summary"), w.Summary).SingleLine().Shrink(1).MinWidth(0).Transition(components.Rise)
				return
			}
			ui.Row(c.Key(fmt.Sprint("now:", now.Step))).Gap(8).AlignItems(ui.Center).Shrink(1).MinWidth(0).Transition(components.Rise).Children(func() {
				if now.Kind == KindThinking {
					ui.Text(c, "Thinking").TextColor(p.Thinking).FontWeight(500).Shrink(0)
					if w.Glimpse != "" {
						ui.Text(c, w.Glimpse).TextColor(p.MutedForeground).FontSize(components.TextXS(th)).SingleLine().Shrink(1).MinWidth(0)
					}
					return
				}
				ui.Text(c, now.Tool.Name).Font("monospace").FontWeight(500).TextColor(p.Foreground).Shrink(0)
				ui.Text(c, now.Tool.Target).Font("monospace").FontSize(components.TextXS(th)).TextColor(p.MutedForeground).SingleLine().Shrink(1).MinWidth(0)
			})
		})

		figure := ""
		switch {
		case outcome == "running" && w.Done() > 0:
			figure = fmt.Sprintf("%d done", w.Done())
		case outcome != "running" && w.MS > 0:
			figure = format.Duration(w.MS)
		}
		if figure != "" {
			ui.Text(c, figure).Font("monospace").FontSize(components.TextXS(th)).TextColor(p.MutedForeground).FontFeatures("tnum").Shrink(0)
		}
		ui.Icon(c, icons.ChevronRight).FontSize(16).Rotate(90 * parts.Progress()).Shrink(0)
	})
}

// step is a line of the work open: on the thread, its mark, then what it
// was and how long it took.
func step(c *ui.Context, t *Transcript, s *Item, i int, last bool) {
	th := c.Theme()
	p := components.PaletteOf(th)
	row := stepButton(c, t, s).Height(26).Transition(components.Cascade(i))
	row.Children(func() {
		thread(c, s, last)
		if s.Kind == KindThinking {
			ui.Text(c, "Thought").FontSize(components.TextXS(th)).FontWeight(500).TextColor(p.Thinking).Shrink(0)
			ui.Text(c, firstLine(s.Text)).FontSize(components.TextXS(th)).TextColor(p.MutedForeground).SingleLine().Grow(1).Shrink(1).MinWidth(0)
			return
		}
		call := s.Tool
		ui.Text(c, call.Name).Font("monospace").FontSize(components.TextXS(th)).FontWeight(500).TextColor(p.Foreground).Shrink(0)
		target := call.Target
		if target == "" {
			target = call.Summary
		}
		ui.Text(c, relative(target, t.State.Root)).Font("monospace").FontSize(components.TextXS(th)).TextColor(p.MutedForeground).SingleLine().Grow(1).Shrink(1).MinWidth(0)
		if call.Edit {
			lineCounts(c, call.Added, call.Removed)
		}
		if call.Done {
			figures(c, format.Duration(call.MS))
		}
	})
}

// thread draws a step's piece of the line that runs down the steps, and
// on it the step's mark: how it went, or a spinner while it runs.
func thread(c *ui.Context, s *Item, last bool) {
	p := components.PaletteOf(c.Theme())
	mark := p.Success
	switch {
	case s.Kind == KindThinking:
		mark = p.Thinking
	case s.Tool.Stopped:
		mark = p.MutedForeground
	case s.Tool.Done && !s.Tool.OK:
		mark = p.Destructive
	}
	running := s.Tool != nil && !s.Tool.Done
	// The line stops short of the mark on either side, so it reads on any
	// fill the row has
	ui.Box(c).Size(16, 26).Shrink(0).Justify(ui.Center).AlignItems(ui.Center).Draw(func(paint *ui.Painter, r ui.Rect) {
		x, y := r.X+r.W/2, r.Y+r.H/2
		gap := float32(5)
		if running {
			gap = 8
		}
		thread := p.MutedForeground.Alpha(0.3)
		paint.Line(x, r.Y, x, y-gap, 1, thread)
		if !last {
			paint.Line(x, y+gap, x, r.Y+r.H, 1, thread)
		}
		if !running {
			paint.Fill(ui.Rect{X: x - 2.5, Y: y - 2.5, W: 5, H: 5}, mark, 2.5)
		}
	}).Children(func() {
		if running {
			components.Spinner(c, "Running", 12, p.Primary)
		}
	})
}

// fileLine is a file the work changed, in sight while the work is closed:
// the lines it gained and lost, the last edit of it a click away.
func fileLine(c *ui.Context, t *Transcript, f *FileChange) {
	th := c.Theme()
	p := components.PaletteOf(th)
	stepButton(c, t, f.Last).Height(24).Children(func() {
		ui.Row(c).Size(16, 16).Shrink(0).Justify(ui.Center).AlignItems(ui.Center).Children(func() {
			ui.Icon(c, icons.Pencil).FontSize(13).TextColor(p.MutedForeground)
		})
		ui.Text(c, f.Path).Font("monospace").FontSize(components.TextXS(th)).TextColor(p.Foreground).SingleLine().Shrink(1).MinWidth(0)
		lineCounts(c, f.Added, f.Removed)
		ui.Box(c).Grow(1)
	})
}

// failedLine is a call that failed, in sight while the work is closed:
// why, as its output's first line says.
func failedLine(c *ui.Context, t *Transcript, s *Item) {
	th := c.Theme()
	p := components.PaletteOf(th)
	call := s.Tool
	stepButton(c, t, s).Height(24).Children(func() {
		icon, color, why := icons.X, p.Destructive, firstLine(call.Output)
		if call.Stopped {
			icon, color, why = icons.Square, p.MutedForeground, "stopped"
		}
		ui.Row(c).Size(16, 16).Shrink(0).Justify(ui.Center).AlignItems(ui.Center).Children(func() {
			ui.Icon(c, icon).FontSize(13).TextColor(color).Label("Failed")
		})
		ui.Text(c, call.Name).Font("monospace").FontSize(components.TextXS(th)).FontWeight(500).TextColor(p.Foreground).Shrink(0)
		ui.Text(c, why).FontSize(components.TextXS(th)).TextColor(color.Mix(p.MutedForeground, 0.35)).SingleLine().Grow(1).Shrink(1).MinWidth(0)
	})
}

// stepButton is a line that shows step s in the inspector when clicked,
// and hides it when clicked again; on the brand's tint while it shows.
func stepButton(c *ui.Context, t *Transcript, s *Item) ui.Element {
	p := components.PaletteOf(c.Theme())
	b := ui.ButtonBase(c).Gap(8).Padding(0, 8).Margin(0, -8).Radius(6).AlignItems(ui.Center).FocusRing(false).
		Transition(components.ColorTransition).Label("Show " + stepName(s))
	switch {
	case t.Inspected == s:
		b.Background(p.Primary.Alpha(0.14))
	case b.Hovered():
		b.Background(p.Accent.Alpha(0.6))
	}
	components.FocusRing(b, p, 0)
	if b.Clicked() {
		if t.Inspected == s {
			t.Inspected = nil
		} else {
			t.Inspected = s
		}
	}
	return b
}

func lineCounts(c *ui.Context, added, removed int) {
	p := components.PaletteOf(c.Theme())
	if added > 0 {
		figures(c, fmt.Sprintf("+%d", added)).TextColor(p.Success)
	}
	if removed > 0 {
		figures(c, fmt.Sprintf("−%d", removed)).TextColor(p.Destructive)
	}
}

// figures is a measure in tabular figures, quiet.
func figures(c *ui.Context, s string) ui.Element {
	th := c.Theme()
	return ui.Text(c, s).Font("monospace").FontSize(components.TextXS(th)).TextColor(components.PaletteOf(th).MutedForeground).FontFeatures("tnum").Shrink(0)
}

// stepName is what a step is called: its tool, or Thinking.
func stepName(s *Item) string {
	if s.Tool != nil {
		return s.Tool.Name
	}
	return "Thinking"
}

func firstLine(s string) string {
	for len(s) > 0 && (s[0] == '\n' || s[0] == ' ') {
		s = s[1:]
	}
	s = format.Head(s, 400)
	for i := range len(s) {
		if s[i] == '\n' {
			return s[:i]
		}
	}
	return s
}
