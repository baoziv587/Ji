package app

// The settings, in place of the session and its sidebar, a page at a time:
// how the window looks, light or dark and in which colors, what waits for
// a yes in the sessions, and the model new sessions start on with the
// providers whose models they can pick. A choice shows at once and is kept.

import (
	"context"
	"fmt"
	"time"

	"github.com/egoist/mygo/ui"

	"desktop/agent"
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
	// Model is what a new session starts on, "provider/id". Unset, the
	// service's own, its --model.
	Model string `json:"model,omitempty"`
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

const (
	pageAppearance = "appearance"
	pageApprovals  = "approvals"
	pageModels     = "models"
)

// settingsPage is a page of the settings, as the sidebar lists it, and
// how it is drawn.
type settingsPage struct {
	id, title string
	gap       float32
	draw      func(a *App, c *ui.Context)
}

var settingsPages = []settingsPage{
	{pageAppearance, "Appearance", 24, (*App).appearance},
	{pageApprovals, "Approvals", 16, (*App).approvals},
	{pageModels, "Models", 24, (*App).modelsPage},
}

// pageOf is the page of id; the first for one unknown.
func pageOf(id string) settingsPage {
	for _, page := range settingsPages {
		if page.id == id {
			return page
		}
	}
	return settingsPages[0]
}

// OpenSettings shows the settings on the page shown last, the providers
// read afresh whichever it is.
func (a *App) OpenSettings() {
	a.settingsOpen = true
	if a.settingsPage == "" {
		a.settingsPage = pageAppearance
	}
	a.loadProviders()
}

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
		switch {
		case a.adding != nil:
			a.adding = nil
		case a.removing != "":
			a.removing = ""
		default:
			a.settingsOpen = false
		}
	}

	page := pageOf(a.settingsPage)
	ui.Box(c).Grow(1).MinHeight(0).Children(func() {
		ui.Scroll(c.Key(page.id)).Fill().Padding(TitleBarHeight+32, 24, 48).ScrollbarInsets(TitleBarHeight, 0, 0).Children(func() {
			ui.Row(c).Justify(ui.Center).Children(func() {
				ui.Column(c).Grow(1).MaxWidth(636).Gap(page.gap).Children(func() { page.draw(a, c) })
			})
		})

		ui.Row(c).Absolute().Top(0).Left(0).Right(0).Height(TitleBarHeight).Gap(6).Padding(0, 10, 0, 16).AlignItems(ui.Center).
			Material(a.bar()).DragWindow().Children(func() {
			ui.Text(c, page.title).FontWeight(600).Grow(1)
			if components.Button(c, "", components.ButtonStyle{Variant: components.Ghost, Size: components.SizeIconSmall, Icon: icons.X}).
				Label("Close Settings").Tooltip("Close (Esc)").Clicked() {
				a.settingsOpen = false
			}
		})
	})
}

// settingsNav is the sidebar while the settings show: the way back to the
// sessions, with how many wait for an answer so that none is missed, over
// the pages.
func (a *App) settingsNav(c *ui.Context) {
	p := components.PaletteOf(c.Theme())
	a.sidebarBar(c, func() {
		back := components.Button(c, "Sessions", components.ButtonStyle{Variant: components.Ghost, Size: components.SizeSmall, Icon: icons.ChevronLeft}).
			Label("Back to the sessions").Tooltip("Back to the sessions (Esc)").Margin(0, 0, 0, -8)
		if back.Clicked() {
			a.settingsOpen = false
		}
		ui.Box(c).Grow(1)
		// Beside the window controls there is room for the count alone
		if n := a.waiting(); n > 0 {
			components.Tag(c, fmt.Sprint(n), p.Waiting).Label(fmt.Sprintf("%d waiting", n)).Tooltip(fmt.Sprintf("%d waiting for an answer", n))
		}
	})

	page := a.settingsPage
	if ui.Sidebar(c, &page, func() {
		ui.SidebarSection(c, "Settings", nil, func() {
			for _, s := range settingsPages {
				item := ui.SidebarItem(c.Key(s.id), s.id, nil, s.title).Height(32).Padding(0, 8).Transition(components.ColorTransition)
				if s.id == a.settingsPage {
					a.chosen(c, item)
				}
			}
		})
	}).Background(ui.Transparent).Grow(1).Changed() {
		// A removal is asked of the page it shows on, and is not left to
		// wait out of sight; a form being filled in is kept
		a.settingsPage, a.removing = page, ""
	}
}

// waiting is how many sessions wait for an answer: an approval or a question.
func (a *App) waiting() int {
	n := 0
	for _, s := range a.list.Sessions {
		if !s.Archived && a.status(s) == "asking" {
			n++
		}
	}
	return n
}

func (a *App) appearance(c *ui.Context) {
	p := components.PaletteOf(c.Theme())
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
	p := components.PaletteOf(c.Theme())

	note := "What waits for a yes, in every session now and every new one. Each can still switch on its own with ⇧⇥."
	if a.Settings.Approvals == "" {
		note = "None chosen: each session starts as the service does, in ask unless it was started with --yolo."
	}
	ui.Text(c, note).TextColor(p.MutedForeground)

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

// modelsPage is the model new sessions start on, then the providers whose
// models it and the sessions pick among.
func (a *App) modelsPage(c *ui.Context) {
	p := components.PaletteOf(c.Theme())
	a.defaultModel(c)
	ui.Box(c).Height(1).Background(p.Border)
	ui.Column(c).Gap(16).Children(func() { a.providers(c) })
}

// providers is the catalog's providers: those detected, with where their
// key comes from and a way to change or forget what is kept of it, then
// the others, folded, each with a way to add a key or log in. A provider
// of one's own, an endpoint, is added from the heading.
func (a *App) providers(c *ui.Context) {
	t := c.Theme()
	p := components.PaletteOf(t)

	a.providersHeading(c)
	if note := a.providerNote; note.text != "" {
		icon, color := icons.Check, p.Success
		if note.failed {
			icon, color = icons.TriangleAlert, p.Destructive
		}
		notice(c, icon, color, note.text)
	}
	if a.catalog.problem != "" {
		ui.Text(c, a.catalog.problem).TextColor(p.Destructive).Selectable()
	}
	if !a.catalog.listed {
		if a.catalog.problem == "" {
			ui.Text(c, "Reading the providers…").TextColor(p.MutedForeground)
		}
		return
	}
	if a.adding != nil {
		a.providerFormCard(c)
	}

	var detected, others []agent.Provider
	for _, provider := range a.catalog.providers {
		if provider.Detected {
			detected = append(detected, provider)
		} else {
			others = append(others, provider)
		}
	}
	if len(detected) == 0 {
		ui.Row(c).Padding(12, 16).Radius(t.Radius+2).Border(1, p.Border).Children(func() {
			ui.Text(c, "None has a key yet: add one with Add provider, set its variable before starting Ji Agent, or log in below.").
				TextColor(p.MutedForeground).Shrink(1)
		})
	} else {
		providerRows(c, detected, func(provider agent.Provider) { a.detectedTrail(c, provider) })
	}
	if len(others) > 0 {
		components.Disclosure(c, fmt.Sprintf("Not detected (%d)", len(others)), ui.Color{}, &a.othersOpen, func() {
			providerRows(c, others, func(provider agent.Provider) { a.undetectedTrail(c, provider) })
		})
	}
}

// providersHeading is the section's title and what it lists, then the ways
// to read them again and to add one.
func (a *App) providersHeading(c *ui.Context) {
	p := components.PaletteOf(c.Theme())
	ui.Row(c).Gap(8).AlignItems(ui.Start).Children(func() {
		ui.Column(c).Grow(1).Shrink(1).Gap(2).Children(func() {
			ui.Text(c, "Providers").FontWeight(500)
			ui.Text(c, "Detected from their API key variables and the keys kept in ~/.ji, by /login or here. A session picks its model among theirs, in its title bar.").
				TextColor(p.MutedForeground)
		})
		if components.Button(c, "", components.ButtonStyle{Variant: components.Ghost, Size: components.SizeIconSmall, Icon: icons.RefreshCw}).
			Label("Check providers again").Tooltip("Check again").Clicked() {
			a.loadProviders()
		}
		if components.Button(c, "Add provider", components.ButtonStyle{Variant: components.Outline, Size: components.SizeSmall, Icon: icons.Plus, Disabled: !a.catalog.listed || a.adding != nil}).
			Tooltip("A key for one of the catalog's, or a server of your own").Clicked() {
			a.openProviderForm(&providerForm{})
		}
	})
}

// detectedTrail is a detected provider's row after its name: how many
// models it has, where its key comes from and what can be changed of it;
// or, while its removal waits for a second yes, the question.
func (a *App) detectedTrail(c *ui.Context, provider agent.Provider) {
	if a.removing == provider.ID {
		a.confirmRemoval(c, provider)
		return
	}
	p := components.PaletteOf(c.Theme())
	figures(c, modelCount(provider.Models), p.MutedForeground)
	color := p.Success
	if provider.Keyless() {
		color = p.MutedForeground
	}
	components.Tag(c, provider.Source, color).Tooltip(sourceNote(provider))
	// As wide in every row, so the tags line up over rows with none
	ui.Row(c).Width(52).Shrink(0).Gap(4).Justify(ui.End).Children(func() { a.providerActions(c, provider) })
}

// undetectedTrail is the way to give a provider not detected a key: a key
// typed in, a login in the session shown, or neither when only the
// environment sets it up.
func (a *App) undetectedTrail(c *ui.Context, provider agent.Provider) {
	t := c.Theme()
	p := components.PaletteOf(t)
	if !provider.APIKey && !provider.OAuth {
		ui.Text(c, "Set up in the environment").FontSize(components.TextXS(t)).TextColor(p.MutedForeground).SingleLine()
		return
	}
	if provider.OAuth {
		_, _, inSession := a.current()
		login := components.Button(c, "Log in", components.ButtonStyle{Variant: components.Ghost, Size: components.SizeExtraSmall, Disabled: !inSession}).
			Label("Log in to " + provider.Name)
		tip := "/login " + provider.ID + " in the session shown: it signs in in the browser"
		if !inSession {
			tip = "Open a session first: /login asks its questions there"
		}
		login.Tooltip(tip)
		if login.Clicked() {
			a.loginTo(provider.ID)
		}
	}
	if provider.APIKey && components.Button(c, "Add key", components.ButtonStyle{Variant: components.Outline, Size: components.SizeExtraSmall}).
		Label("Add a key for "+provider.Name).Clicked() {
		a.keyForm(provider.ID)
	}
}

// providerActions is what can be changed of a detected provider: an
// endpoint itself, or the key or login kept for one of the catalog's. What
// the environment gives is changed there, so has none.
func (a *App) providerActions(c *ui.Context, provider agent.Provider) {
	icon := func(svg *ui.SVG, label string) bool {
		return components.Button(c, "", components.ButtonStyle{Variant: components.Ghost, Size: components.SizeIconExtraSmall, Icon: svg}).
			Label(label).Tooltip(label).Clicked()
	}
	switch {
	case provider.Endpoint != nil:
		if icon(icons.Pencil, "Change "+provider.Name) {
			a.endpointForm(provider)
		}
	case !provider.Stored:
		return
	case provider.APIKey && !provider.SignedIn():
		if icon(icons.Pencil, "Replace "+provider.Name+"'s key") {
			a.keyForm(provider.ID)
		}
	}
	if icon(icons.Trash2, removalOf(provider).label) {
		a.removing, a.providerNote = provider.ID, providerNote{}
	}
}

// sourceNote says where a provider's key comes from, and where to change it.
func sourceNote(provider agent.Provider) string {
	switch {
	case provider.Keyless():
		return "Asked with no key: add one with the pencil if it wants one"
	case provider.SignedIn():
		return "Signed in with /login, kept in ~/.ji"
	case provider.Stored:
		return "Kept in ~/.ji/auth.json, by /login or here"
	}
	return "Set in the environment: change it there, or add a key here to use in its place"
}

// defaultModel is the model new sessions start on, as the appearance's
// rows are laid out: what it is to the left, the picker of models and a
// way back to the service's own to the right.
func (a *App) defaultModel(c *ui.Context) {
	t := c.Theme()
	p := components.PaletteOf(t)
	model := a.Settings.Model

	ui.Row(c).Gap(16).AlignItems(ui.Center).Children(func() {
		ui.Column(c).Grow(1).Shrink(1).Gap(2).Children(func() {
			ui.Text(c, "Default model").FontWeight(500)
			note := "New sessions start on it; each can switch in its title bar."
			if model == "" {
				note = "None chosen: new sessions start on the service's own, its --model."
			}
			ui.Text(c, note).TextColor(p.MutedForeground)
			if provider, ok := a.provider(providerOf(model)); ok && !provider.Detected {
				ui.Text(c, provider.Name+" has no key now: its sessions cannot reply until it has one.").TextColor(p.Warning)
			}
		})

		ui.Row(c).Gap(4).AlignItems(ui.Center).Shrink(0).Children(func() {
			if model != "" && components.Button(c, "", components.ButtonStyle{Variant: components.Ghost, Size: components.SizeIconSmall, Icon: icons.X}).
				Label("Use the service's model").Tooltip("Back to the service's own").Clicked() {
				a.Settings.Model = ""
			}

			trigger := ui.ButtonBase(c).Height(32).MaxWidth(280).Padding(0, 8, 0, 12).Gap(6).Radius(t.Radius).AlignItems(ui.Center).
				Border(1, p.Input).FocusRing(false).Transition(components.ColorTransition).Label("Choose the default model")
			if trigger.Hovered() || a.defaults.open {
				trigger.Background(p.Accent)
			}
			components.FocusRing(trigger, p, 0)
			trigger.Children(func() {
				shown, color := model, p.Foreground
				if model == "" {
					shown, color = "Service default", p.MutedForeground
				}
				ui.Text(c, shown).TextColor(color).SingleLine().Shrink(1)
				ui.Icon(c, icons.ChevronDown).FontSize(14).TextColor(p.MutedForeground).Shrink(0)
			})
			if trigger.Clicked() {
				a.toggleModels(&a.defaults, model)
			}
			a.modelMenu(c, trigger, &a.defaults, model, false, func(spec string) { a.Settings.Model = spec })
		})
	})
}

// provider is the provider of the catalog with this id.
func (a *App) provider(id string) (agent.Provider, bool) {
	for _, p := range a.catalog.providers {
		if p.ID == id {
			return p, true
		}
	}
	return agent.Provider{}, false
}

// providerRows is providers in one bordered list, a row each: its name and
// id, or an endpoint's address, then what trail adds.
func providerRows(c *ui.Context, providers []agent.Provider, trail func(agent.Provider)) {
	t := c.Theme()
	p := components.PaletteOf(t)
	ui.Column(c).Radius(t.Radius+2).Border(1, p.Border).Clip().Children(func() {
		for i, provider := range providers {
			row := ui.Row(c.Key(provider.ID)).Height(48).Padding(0, 16).Gap(12).AlignItems(ui.Center)
			if i > 0 {
				row.BorderWidth(1, 0, 0, 0).BorderColor(p.Border)
			}
			detail := provider.ID
			if provider.Endpoint != nil {
				detail = hostOf(provider.Endpoint.BaseURL)
			}
			row.Children(func() {
				ui.Row(c).Grow(1).Shrink(1).Gap(8).AlignItems(ui.Center).Children(func() {
					ui.Text(c, provider.Name).FontWeight(500).SingleLine().Shrink(0)
					ui.Text(c, detail).Font("monospace").FontSize(components.TextCode(t)).TextColor(p.MutedForeground).SingleLine().Shrink(1)
				})
				trail(provider)
			})
		}
	})
}

// loginTo runs /login in the session shown, whose questions ask how and
// for the key, and shows it.
func (a *App) loginTo(provider string) {
	_, view, ok := a.current()
	if !ok {
		return
	}
	a.settingsOpen = false
	a.command(view, "/login "+provider)
}

func modelCount(n int) string {
	if n == 1 {
		return "1 model"
	}
	return fmt.Sprintf("%d models", n)
}
