package app

// The settings, in place of the session: how the window looks, light or
// dark and in which colors, and what waits for a yes in the sessions. A
// choice shows at once and is kept.

import (
	"context"
	"time"

	"github.com/egoist/mygo/ui"

	"desktop/ui/components"
	"desktop/ui/icons"
)

// Settings are what the person chooses, kept from one run to the next.
type Settings struct {
	Appearance components.Appearance `json:"appearance,omitempty"`
	Theme      string                `json:"theme,omitempty"`
	// Transparency is how much the window's glass lets through, from 0,
	// solid, to 100: kept even at 0, which would otherwise read as unset.
	Transparency float64 `json:"transparency"`
	// Approvals is every session's mode: ask, auto or yolo. Unset, each
	// starts in the service's own.
	Approvals string `json:"approvals,omitempty"`
}

// DefaultSettings are the settings of a first run, under those kept.
var DefaultSettings = Settings{Transparency: transparencyStandard}

var appearances = []struct {
	value components.Appearance
	label string
	icon  *ui.SVG
}{
	{components.System, "System", icons.Monitor},
	{components.Light, "Light", icons.Sun},
	{components.Dark, "Dark", icons.Moon},
}

// approvals are the modes, in the terminal's words.
var approvals = []struct{ mode, note string }{
	{"ask", "Every command, file read and change waits for a yes."},
	{"auto", "Files inside the folder are approved; commands still wait for a yes."},
	{"yolo", "Nothing waits for a yes."},
}

func (a *App) OpenSettings() { a.settingsOpen = true }

// saveSettings hands the settings on to be kept when they have changed.
func (a *App) saveSettings() {
	if a.Settings == a.saved || a.sliding {
		return
	}

	modeChanged := a.Settings.Approvals != a.saved.Approvals
	a.saved = a.Settings

	if modeChanged {
		a.applyApprovals()
	}
	if a.SaveSettings != nil {
		a.SaveSettings(a.Settings)
	}
}

// applyApprovals sets every session to the mode the settings choose: when
// it is chosen, and on each connection, as the service keeps none of the
// window's.
func (a *App) applyApprovals() {
	mode := a.Settings.Approvals
	if mode == "" {
		return
	}

	a.async(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		err := a.agent.SetModes(ctx, mode)
		a.update(func() {
			// Not connected, it is set again once the window is
			if err != nil && a.link.up {
				a.toast = &toast{message: "Could not set approvals to " + mode + ": " + err.Error(), action: "Retry", run: a.applyApprovals}
			}
		})
	})
}

func (a *App) settings(c *ui.Context) {
	if c.Shortcut(0, ui.KeyEscape) {
		a.settingsOpen = false
	}

	ui.Box(c).Grow(1).MinHeight(0).Children(func() {
		ui.Scroll(c).Fill().Padding(TitleBarHeight+32, 24, 48).ScrollbarInsets(TitleBarHeight, 0, 0).Children(func() {
			ui.Row(c).Justify(ui.Center).Children(func() {
				ui.Column(c).Grow(1).MaxWidth(636).Gap(56).Children(func() {
					ui.Column(c).Gap(24).Children(func() { a.appearance(c) })
					ui.Column(c).Gap(16).Children(func() { a.approvals(c) })
				})
			})
		})

		ui.Row(c).Absolute().Top(0).Left(0).Right(0).Height(TitleBarHeight).Gap(6).Padding(0, 10, 0, 16).AlignItems(ui.Center).
			Material(a.bar()).DragWindow().Children(func() {
			ui.Text(c, "Settings").FontWeight(600).Grow(1)
			if components.Button(c, "", components.ButtonStyle{Variant: components.Ghost, Size: components.SizeIconSmall, Icon: icons.X}).
				Label("Close Settings").Tooltip("Close (Esc)").Clicked() {
				a.settingsOpen = false
			}
		})
	})
}

func (a *App) appearance(c *ui.Context) {
	t := c.Theme()
	p := components.PaletteOf(t)
	ui.Text(c, "Appearance").FontSize(components.TextLG(t)).FontWeight(500).LetterSpacing(-0.4)

	ui.Row(c).Gap(16).AlignItems(ui.Center).Children(func() {
		ui.Column(c).Grow(1).Shrink(1).Gap(2).Children(func() {
			ui.Text(c, "Mode").FontWeight(500)
			ui.Text(c, modeNote(a.Settings.Appearance, a.systemDark)).TextColor(p.MutedForeground)
		})
		a.modes(c)
	})

	ui.Row(c).Gap(16).AlignItems(ui.Start).Children(func() {
		ui.Column(c).Grow(1).Shrink(1).Gap(2).Children(func() {
			ui.Text(c, "Transparency").FontWeight(500)
			note := "What shows through the sidebar and the title bars: the desktop, and what scrolls under them."
			if !c.Vibrancy() {
				note = "What scrolls under the title bars shows through them; the sidebar has no desktop to show here."
			}
			ui.Text(c, note).TextColor(p.MutedForeground)
		})
		a.transparency(c)
	})

	ui.Box(c).Height(1).Background(p.Border)

	ui.Column(c).Gap(12).Children(func() {
		ui.Column(c).Gap(2).Children(func() {
			ui.Text(c, "Color theme").FontWeight(500)
			ui.Text(c, "Each comes in light and dark; shown here as the window is now.").TextColor(p.MutedForeground)
		})
		ui.RadioGroup(c, func() {
			for _, s := range components.Schemes {
				a.schemeCard(c, s)
			}
		}).Row().Wrap().Gap(12).Label("Color theme")
	})
}

func modeNote(mode components.Appearance, systemDark bool) string {
	switch mode {
	case components.Light:
		return "Always light, whatever macOS uses."
	case components.Dark:
		return "Always dark, whatever macOS uses."
	}

	if systemDark {
		return "Follows macOS, which is dark now."
	}
	return "Follows macOS, which is light now."
}

// modes is the choice of appearance, as shadcn/ui's Tabs list: the chosen
// one raised on a muted track.
func (a *App) modes(c *ui.Context) {
	t := c.Theme()
	p := components.PaletteOf(t)
	ui.RadioGroup(c, func() {
		for _, m := range appearances {
			tab := ui.RadioBase(c, &a.Settings.Appearance, m.value).Label(m.label).
				Height(30).Padding(0, 10).Gap(6).Radius(t.Radius - 2).AlignItems(ui.Center).
				FocusRing(false).Transition(components.ColorTransition)

			chosen := a.Settings.Appearance == m.value
			color := p.MutedForeground
			switch {
			case chosen && t.Dark:
				tab.Background(p.Input.Alpha(0.3)).Border(1, p.Input)
				color = p.Foreground
			case chosen:
				tab.Background(p.Background).Shadow(0, 1, 3, 0, ui.Oklch(0, 0, 0).Alpha(0.1))
				color = p.Foreground
			case tab.Hovered():
				color = p.Foreground
			}
			components.FocusRing(tab, p, 0)

			tab.Children(func() {
				ui.Icon(c, m.icon).FontSize(14).TextColor(color)
				ui.Text(c, m.label).FontWeight(500).TextColor(color).SingleLine()
			})
		}
	}).Row().Shrink(0).Height(36).Padding(3).Gap(2).Radius(t.Radius).Background(p.Muted).Label("Mode")
}

// transparency is the slider of the window's glass, its ends named under it.
func (a *App) transparency(c *ui.Context) {
	t := c.Theme()
	p := components.PaletteOf(t)
	ui.Column(c).Width(236).Shrink(0).Gap(2).Children(func() {
		a.sliding = ui.StepSlider(c, &a.Settings.Transparency, transparencySolid, transparencyClear, transparencyStep).
			Label("Transparency").Pressed()
		ui.Row(c).Justify(ui.SpaceBetween).Children(func() {
			for _, end := range []string{"Solid", "Clear"} {
				ui.Text(c, end).FontSize(components.TextXS(t)).TextColor(p.MutedForeground)
			}
		})
	})
}

// schemeCard is a scheme to choose, shown as a small window in its
// colors: the sidebar with a session chosen, a message, a reply and the
// input with its button.
func (a *App) schemeCard(c *ui.Context, s *components.Scheme) {
	t := c.Theme()
	p := components.PaletteOf(t)
	q := s.Of(t.Dark)
	chosen := components.SchemeNamed(a.Settings.Theme) == s

	card := ui.RadioBase(c.Key(s.Name), &a.Settings.Theme, s.Name).Column().Width(150).Gap(8).Padding(4).Radius(12).
		FocusRing(false).Transition(components.ColorTransition).Label(s.Name + " theme")

	edge := p.Border
	switch {
	case chosen:
		edge = p.Primary
	case card.Hovered():
		edge = p.MutedForeground.Alpha(0.5)
	}
	components.FocusRing(card, p, 0)

	card.Children(func() {
		window := ui.Row(c).Height(84).Radius(8).Clip().Background(q.Background).Border(1, edge).Transition(components.ColorTransition)
		if chosen {
			window.Shadow(0, 0, 0, 1, p.Primary)
		}
		window.Children(func() {
			line := func(w float32, color ui.Color) {
				ui.Box(c).Width(w).Height(4).Radius(2).Background(color).Shrink(0)
			}

			ui.Column(c).Width(38).Shrink(0).Padding(10, 5).Gap(6).Background(q.Sidebar).BorderWidth(0, 1, 0, 0).BorderColor(q.SidebarBorder).Children(func() {
				line(18, q.MutedForeground.Alpha(0.45))
				ui.Row(c).Height(10).Padding(0, 3).Radius(3).Background(q.SidebarAccent).AlignItems(ui.Center).Children(func() {
					line(14, q.Foreground.Alpha(0.6))
				})
				line(22, q.Foreground.Alpha(0.3))
				line(16, q.Foreground.Alpha(0.3))
			})

			ui.Column(c).Grow(1).Padding(8, 8, 7).Gap(5).Children(func() {
				ui.Box(c).AlignSelf(ui.End).Width(44).Height(10).Radius(4).Background(q.Secondary)
				line(66, q.Foreground.Alpha(0.45))
				line(48, q.Foreground.Alpha(0.45))
				ui.Box(c).Grow(1)
				ui.Row(c).Height(16).Padding(0, 3, 0, 6).Radius(5).Border(1, q.Input).AlignItems(ui.Center).Justify(ui.End).Children(func() {
					ui.Box(c).Size(10, 10).Radius(5).Background(q.Primary)
				})
			})
		})

		ui.Row(c).Gap(6).Padding(0, 2).AlignItems(ui.Center).Children(func() {
			ui.Text(c, s.Name).FontWeight(500).Grow(1).SingleLine()
			if chosen {
				ui.Icon(c, icons.Check).FontSize(14).TextColor(p.Primary)
			}
		})
	})
}

func (a *App) approvals(c *ui.Context) {
	t := c.Theme()
	p := components.PaletteOf(t)

	ui.Column(c).Gap(4).Children(func() {
		ui.Text(c, "Approvals").FontSize(components.TextLG(t)).FontWeight(500).LetterSpacing(-0.4)
		note := "What waits for a yes, in every session now and every new one. Each can still switch on its own with ⇧⇥."
		if a.Settings.Approvals == "" {
			note = "None chosen: each session starts as the service does, in ask unless it was started with --yolo."
		}
		ui.Text(c, note).TextColor(p.MutedForeground)
	})

	ui.RadioGroup(c, func() {
		for _, m := range approvals {
			a.approval(c.Key(m.mode), m.mode, m.note)
		}
	}).Gap(8).Label("Approvals")
}

// approval is a mode to choose, as a card: its radio, its name and what
// it asks about. Yolo, chosen, is in the warning color, as the status
// line shows it, and says what it lets through.
func (a *App) approval(c *ui.Context, mode, note string) {
	t := c.Theme()
	p := components.PaletteOf(t)
	chosen := a.Settings.Approvals == mode
	mark := p.Primary
	if mode == "yolo" {
		mark = p.Warning
	}

	row := ui.RadioBase(c, &a.Settings.Approvals, mode).Label(mode).Gap(12).Padding(12, 16).AlignItems(ui.Start).
		Radius(t.Radius+2).Border(1, p.Border).FocusRing(false).Transition(components.ColorTransition)
	switch {
	case chosen:
		row.Border(1, mark).Background(mark.Alpha(0.06))
	case row.Hovered():
		row.Border(1, p.MutedForeground.Alpha(0.5))
	}
	components.FocusRing(row, p, 0)

	row.Children(func() {
		edge := p.Input
		if chosen {
			edge = mark
		}
		ui.Row(c).Size(16, 16).Shrink(0).Margin(2, 0, 0).Radius(8).Border(1, edge).Justify(ui.Center).AlignItems(ui.Center).
			Transition(components.ColorTransition).Children(func() {
			if chosen {
				ui.Box(c).Size(8, 8).Radius(4).Background(mark)
			}
		})

		ui.Column(c).Grow(1).Shrink(1).Gap(2).Children(func() {
			ui.Text(c, mode).FontWeight(500)
			ui.Text(c, note).TextColor(p.MutedForeground)
			if chosen && mode == "yolo" {
				ui.Row(c).Gap(6).Margin(6, 0, 0).AlignItems(ui.Center).Children(func() {
					ui.Icon(c, icons.TriangleAlert).FontSize(14).TextColor(p.Warning)
					ui.Text(c, "Commands run and files change unseen, outside the folder too.").TextColor(p.Warning).Shrink(1)
				})
			}
		})
	})
}
