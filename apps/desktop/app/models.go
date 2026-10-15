package app

// The providers and their models, as the service lists them: the settings
// show which are detected, and a session's title bar picks its model among
// theirs.

import (
	"context"
	"strings"

	"github.com/egoist/mygo/ui"

	"desktop/agent"
	"desktop/format"
	"desktop/ui/components"
	"desktop/ui/icons"
)

// catalog is what the window last read of the providers. Each is read
// again as the settings or a picker opens: a key set or a login since
// shows then.
type catalog struct {
	providers []agent.Provider
	listed    bool
	problem   string
	// Each provider's models once read, and those being read.
	models  map[string][]agent.Model
	reading map[string]bool
}

// modelPicker is what a session's picker of models holds while open: the
// provider whose models it lists, what filters them, and the one the
// arrows are on.
type modelPicker struct {
	open     bool
	provider string
	query    string
	at       int
	list     ui.ListState
	// The models shown, filtered once for each provider and query.
	shown    []agent.Model
	shownFor [2]string
	shownOf  []agent.Model
}

// loadProviders reads the providers again, keeping those read before
// meanwhile.
func (a *App) loadProviders() {
	a.request(func(ctx context.Context) {
		providers, err := a.agent.Providers(ctx)
		a.update(func() {
			a.catalog.problem = ""
			if err != nil {
				a.catalog.problem = "Could not read the providers: " + err.Error()
				return
			}
			a.catalog.providers, a.catalog.listed = providers, true
		})
	})
}

// loadModels reads a provider's models, once.
func (a *App) loadModels(provider string) {
	if provider == "" || a.catalog.models[provider] != nil || a.catalog.reading[provider] {
		return
	}
	if a.catalog.reading == nil {
		a.catalog.reading = map[string]bool{}
		a.catalog.models = map[string][]agent.Model{}
	}
	a.catalog.reading[provider] = true
	a.request(func(ctx context.Context) {
		models, err := a.agent.Models(ctx, provider)
		a.update(func() {
			delete(a.catalog.reading, provider)
			if err != nil {
				a.catalog.problem = "Could not read the models of " + provider + ": " + err.Error()
				return
			}
			a.catalog.models[provider] = append([]agent.Model{}, models...)
		})
	})
}

// pickable is the providers a session can pick a model of: the detected
// ones, and the one of its model now even when it is not.
func (a *App) pickable(current string) []agent.Provider {
	var out []agent.Provider
	for _, p := range a.catalog.providers {
		if p.Detected || p.ID == current {
			out = append(out, p)
		}
	}
	return out
}

func (a *App) useModel(view *sessionView, model string) {
	a.callState(view, func(ctx context.Context) (agent.State, error) { return a.agent.UseModel(ctx, view.id, model) })
}

// providerOf is the provider of a model, "provider/id"; the id itself can
// have slashes, as OpenRouter's do.
func providerOf(model string) string {
	provider, _, _ := strings.Cut(model, "/")
	return provider
}

// filtered is the provider's models whose id or name has the query in it,
// worked out again only when the models or the query change.
func (m *modelPicker) filtered(models []agent.Model) []agent.Model {
	key := [2]string{m.provider, m.query}
	if key == m.shownFor && len(models) == len(m.shownOf) && (len(models) == 0 || &models[0] == &m.shownOf[0]) {
		return m.shown
	}
	m.shownFor, m.shownOf = key, models
	m.shown = m.shown[:0]
	for _, model := range models {
		if matches(m.query, model.ID, model.Name) {
			m.shown = append(m.shown, model)
		}
	}
	m.at = min(m.at, max(len(m.shown)-1, 0))
	return m.shown
}

// matches is whether any of the texts has what is typed in it, in any case;
// all do when nothing is typed.
func matches(query string, texts ...string) bool {
	query = strings.ToLower(strings.TrimSpace(query))
	if query == "" {
		return true
	}
	for _, text := range texts {
		if strings.Contains(strings.ToLower(text), query) {
			return true
		}
	}
	return false
}

// modelSelect is the session's model in its title bar, which opens the
// picker of models. Off while the session replies, as a reply's steps go to
// the model it started with.
func (a *App) modelSelect(c *ui.Context, s agent.Session, view *sessionView) {
	t := c.Theme()
	p := components.PaletteOf(t)
	st := view.t.State
	picker := &view.models
	off := s.Archived || st.Replying

	trigger := ui.ButtonBase(c).Height(24).Padding(0, 2, 0, 6).Margin(0, -2, 0, -6).Gap(2).Radius(6).AlignItems(ui.Center).Shrink(1).MinWidth(0).
		FocusRing(false).Transition(components.ColorTransition).Label("Model")
	if off {
		trigger.Disabled(true)
	} else if trigger.Hovered() || picker.open {
		trigger.Background(p.Accent)
	}
	components.FocusRing(trigger, p, 1)
	color := p.MutedForeground
	if picker.open {
		color = p.Foreground
	}
	trigger.Children(func() {
		ui.Text(c, st.Model).TextColor(color).SingleLine().Shrink(1)
		if !off {
			ui.Icon(c, icons.ChevronDown).FontSize(14).TextColor(p.MutedForeground.Alpha(0.6)).Shrink(0)
		}
	})
	switch {
	case st.Replying:
		trigger.Tooltip("Stop the reply to switch models")
	case !picker.open:
		trigger.Tooltip("Model")
	}
	if trigger.Clicked() {
		a.toggleModels(picker, st.Model)
	}
	a.modelMenu(c, trigger, picker, st.Model, true, func(spec string) { a.useModel(view, spec) })
}

// toggleModels opens the picker on the provider of current, reading the
// providers again, or closes it.
func (a *App) toggleModels(picker *modelPicker, current string) {
	picker.open = !picker.open
	if picker.open {
		a.loadProviders()
		a.showProvider(picker, providerOf(current))
	}
}

// showProvider lists a provider's models in the picker, from the top and
// unfiltered.
func (a *App) showProvider(picker *modelPicker, provider string) {
	picker.provider, picker.query, picker.at = provider, "", 0
	a.loadModels(provider)
}

// modelMenu is the picker under anchor while it is open: the providers
// detected down the left, the chosen one's models, filtered by what is
// typed, on the right. pick takes the model chosen, "provider/id", unless
// it is current; link adds the way to the settings' list of providers.
func (a *App) modelMenu(c *ui.Context, anchor ui.Element, picker *modelPicker, current string, link bool, pick func(spec string)) {
	t := c.Theme()
	p := components.PaletteOf(t)
	ui.PopoverBase(c, anchor, &picker.open, func(panel ui.Element) {
		panel.Margin(4, 0, 0, 0).Width(520).Radius(t.Radius).Background(p.Popover).Border(1, p.Border).Clip().
			Shadow(0, 4, 6, -1, ui.RGBA(0, 0, 0, 0.1))
		ui.Row(c).Height(340).AlignItems(ui.Stretch).Children(func() {
			a.pickerProviders(c, picker, current, link)
			ui.Box(c).Width(1).Background(p.Border).Shrink(0)
			a.pickerModels(c, picker, current, pick)
		})
	})
}

// pickerProviders is the picker's column of providers, and the way to the
// others in the settings with link.
func (a *App) pickerProviders(c *ui.Context, picker *modelPicker, current string, link bool) {
	t := c.Theme()
	p := components.PaletteOf(t)
	ui.Column(c).Width(176).Shrink(0).Padding(4).Gap(2).Children(func() {
		ui.Text(c, "Providers").FontSize(components.TextXS(t)).FontWeight(500).TextColor(p.MutedForeground).Padding(6, 8, 2)
		ui.Scroll(c).Grow(1).MinHeight(0).Children(func() {
			ui.Column(c).Gap(2).Children(func() {
				providers := a.pickable(providerOf(current))
				// A picker opened with no model, the default before one is chosen, starts on the first provider
				if picker.provider == "" && len(providers) > 0 {
					a.showProvider(picker, providers[0].ID)
				}
				if len(providers) == 0 {
					note := "Reading…"
					if a.catalog.listed {
						note = "None has a key: set its API key variable, or /login."
					}
					ui.Text(c, note).FontSize(components.TextXS(t)).TextColor(p.MutedForeground).Padding(6, 8)
				}
				for _, provider := range providers {
					row := ui.ButtonBase(c.Key(provider.ID)).Height(30).Padding(0, 8).Gap(6).Radius(t.Radius - 2).AlignItems(ui.Center).
						FocusRing(false).Transition(components.ColorTransition).Label(provider.Name)
					chosen := provider.ID == picker.provider
					if chosen || row.Hovered() {
						row.Background(p.Accent)
					}
					components.FocusRing(row, p, 0)
					row.Children(func() {
						name := ui.Text(c, provider.Name).SingleLine().Shrink(1).Grow(1)
						if chosen {
							name.FontWeight(500)
						}
						figures(c, format.Count(provider.Models), p.MutedForeground).Shrink(0)
					})
					if !provider.Detected {
						row.Tooltip("No key now: set its API key variable, or /login " + provider.ID)
					}
					if row.Clicked() && !chosen {
						a.showProvider(picker, provider.ID)
					}
				}
			})
		})
		if !link {
			return
		}
		settings := ui.ButtonBase(c).Height(28).Padding(0, 8).Gap(6).Radius(t.Radius - 2).AlignItems(ui.Center).Justify(ui.Start).Shrink(0).
			FocusRing(false).Transition(components.ColorTransition).Label("All providers")
		if settings.Hovered() {
			settings.Background(p.Accent)
		}
		components.FocusRing(settings, p, 0)
		settings.Children(func() {
			ui.Icon(c, icons.Settings).FontSize(14).TextColor(p.MutedForeground)
			ui.Text(c, "All providers").FontSize(components.TextXS(t)).TextColor(p.MutedForeground).SingleLine()
		})
		if settings.Clicked() {
			picker.open = false
			a.OpenSettings()
		}
	})
}

// pickerModels is the chosen provider's models under the filter: the
// arrows move among them and Enter picks, as a click does.
func (a *App) pickerModels(c *ui.Context, picker *modelPicker, current string, choose func(spec string)) {
	t := c.Theme()
	p := components.PaletteOf(t)
	models := picker.filtered(a.catalog.models[picker.provider])
	pick := func(m agent.Model) {
		picker.open = false
		if spec := picker.provider + "/" + m.ID; spec != current {
			choose(spec)
		}
	}

	ui.Column(c).Grow(1).MinWidth(0).Children(func() {
		ui.Row(c).Height(40).Padding(0, 12).Gap(8).AlignItems(ui.Center).BorderWidth(0, 0, 1, 0).BorderColor(p.Border).Shrink(0).Children(func() {
			ui.Icon(c, icons.Search).FontSize(14).TextColor(p.MutedForeground)
			ui.TextInputBase(c.Key("models:"+picker.provider), &picker.query).Placeholder("Search models").Label("Search models").AutoFocus().Grow(1).
				HandleInput(func(ev ui.InputEvent) bool {
					if ev.Kind != ui.InputKeyDown || ev.Mods != 0 {
						return false
					}
					switch ev.Key {
					case ui.KeyDown:
						picker.at = min(picker.at+1, max(len(models)-1, 0))
						picker.list.ScrollIntoView(picker.at)
						return true
					case ui.KeyUp:
						picker.at = max(picker.at-1, 0)
						picker.list.ScrollIntoView(picker.at)
						return true
					case ui.KeyEnter:
						if picker.at < len(models) {
							pick(models[picker.at])
						}
						return true
					}
					return false
				})
		})

		ui.List(c, &picker.list, len(models), func(i int) {
			m := models[i]
			row := ui.ButtonBase(c).Height(32).Padding(0, 8).Gap(8).Radius(t.Radius - 2).AlignItems(ui.Center).
				FocusRing(false).Label(m.ID)
			if row.Hovered() {
				picker.at = i
			}
			if i == picker.at {
				row.Background(p.Accent)
			}
			row.Children(func() {
				ui.Text(c, nameOf(m)).TextColor(p.Foreground).SingleLine().Shrink(1).Grow(1).Tooltip(m.ID)
				if m.ContextWindow > 0 {
					figures(c, format.Count(m.ContextWindow), p.MutedForeground).Shrink(0).Tooltip("Context window, in tokens")
				}
				if picker.provider+"/"+m.ID == current {
					ui.Icon(c, icons.Check).FontSize(16).TextColor(p.Foreground)
				} else {
					ui.Box(c).Size(16, 16).Shrink(0)
				}
			})
			if row.Clicked() {
				pick(m)
			}
		}).Grow(1).Padding(4).Children(func() {
			if len(models) > 0 {
				return
			}
			note := "No model matches."
			switch {
			case a.catalog.reading[picker.provider]:
				note = "Reading the models…"
			case picker.provider == "":
				note = "Choose a provider."
			case a.catalog.models[picker.provider] == nil && a.catalog.problem != "":
				note = a.catalog.problem
			}
			ui.Text(c, note).TextColor(p.MutedForeground).Padding(8)
		})
	})
}

// nameOf is a model as a list names it: its name, or its id when it has
// none.
func nameOf(m agent.Model) string {
	if m.Name == "" {
		return m.ID
	}
	return m.Name
}
