package app

// Adding a provider in the settings: a key typed in for one of the
// catalog's, kept where /login keeps it, or a server of one's own that
// speaks OpenAI's chat completions. And taking either away again.

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/egoist/mygo/ui"

	"desktop/agent"
	"desktop/ui/components"
	"desktop/ui/icons"
)

// fetchedKept is how many models a server may list for all of them to
// start chosen; of more, as a proxy's hundreds, the person picks.
const fetchedKept = 12

// providerForm is what the form holds while it is open.
type providerForm struct {
	// The provider whose key is typed in, or none for an endpoint, once
	// chosen; listed says the form began on the list of providers, where
	// its back button returns.
	chosen   bool
	provider string
	listed   bool
	query    string
	// The endpoint changed, or none for one added.
	editing string
	stored  bool
	name    string
	baseURL string
	key     string
	// The ids the server listed and those typed in, each kept or not.
	models   []modelChoice
	typed    string
	advanced bool
	window   string
	thinks   bool

	probing bool
	saving  bool
	problem string
}

type modelChoice struct {
	id   string
	kept bool
}

// providerNote is what the last change of the providers did, said under
// their heading until the next.
type providerNote struct {
	text   string
	failed bool
}

func (a *App) openProviderForm(f *providerForm) {
	a.adding, a.removing, a.providerNote = f, "", providerNote{}
}

// keyForm is the form for a provider's key, opened from its row.
func (a *App) keyForm(provider string) {
	a.openProviderForm(&providerForm{chosen: true, provider: provider})
}

// endpointForm is the form filled in with an endpoint, to change it.
func (a *App) endpointForm(p agent.Provider) {
	e := p.Endpoint
	f := &providerForm{chosen: true, editing: p.ID, stored: p.Stored, name: p.Name, baseURL: e.BaseURL}
	for _, m := range e.Models {
		f.models = append(f.models, modelChoice{m.ID, true})
		if m.ContextWindow > 0 {
			f.window = strconv.Itoa(m.ContextWindow)
		}
		f.thinks = f.thinks || m.Reasoning
	}
	f.advanced = f.window != "" || f.thinks
	a.openProviderForm(f)
}

func (a *App) providerFormCard(c *ui.Context) {
	f := a.adding
	t := c.Theme()
	p := components.PaletteOf(t)
	ui.Column(c).Gap(16).Padding(16).Radius(t.Radius+2).Border(1, p.Border).Background(p.Card).Children(func() {
		ui.Row(c).Gap(4).AlignItems(ui.Center).Children(func() {
			if f.chosen && f.listed && components.Button(c, "", components.ButtonStyle{Variant: components.Ghost, Size: components.SizeIconExtraSmall, Icon: icons.ChevronLeft}).
				Label("Choose another provider").Tooltip("Choose another").Clicked() {
				*f = providerForm{listed: true, query: f.query}
			}
			ui.Text(c, f.title(a.providerName(f.provider))).FontWeight(500).Grow(1).Shrink(1).SingleLine()
			if components.Button(c, "", components.ButtonStyle{Variant: components.Ghost, Size: components.SizeIconExtraSmall, Icon: icons.X}).
				Label("Cancel").Tooltip("Cancel (Esc)").Clicked() {
				a.adding = nil
			}
		})

		switch {
		case !f.chosen:
			a.providerChoices(c, f)
			return
		case f.provider != "":
			a.keyFields(c, f)
		default:
			a.endpointFields(c, f)
		}

		if f.problem != "" {
			notice(c, icons.TriangleAlert, p.Destructive, f.problem)
		}

		ui.Row(c).Gap(8).Justify(ui.End).Children(func() {
			if components.Button(c, "Cancel", components.ButtonStyle{Variant: components.Ghost, Size: components.SizeSmall}).Clicked() {
				a.adding = nil
			}
			if components.Button(c, f.saveLabel(), components.ButtonStyle{Size: components.SizeSmall, Disabled: !f.ready()}).Clicked() {
				a.saveProviderForm()
			}
		})
	})
}

// providerChoices is the catalog's providers a key can be typed in for,
// filtered by what is typed, and last an endpoint of one's own.
func (a *App) providerChoices(c *ui.Context, f *providerForm) {
	t := c.Theme()
	p := components.PaletteOf(t)
	components.TextInput(c, &f.query).Placeholder("Search providers").Label("Search providers").AutoFocus()

	ui.Column(c).Radius(t.Radius).Border(1, p.Border).Clip().Children(func() {
		ui.Scroll(c).MaxHeight(264).Children(func() {
			for _, provider := range a.catalog.providers {
				if !provider.APIKey || provider.Endpoint != nil {
					continue
				}
				if !matches(f.query, provider.Name, provider.ID) {
					continue
				}
				if choice(c.Key(provider.ID), nil, provider.Name, provider.ID, provider.Source).Clicked() {
					*f = providerForm{chosen: true, provider: provider.ID, listed: true, query: f.query}
				}
			}
			if choice(c.Key("endpoint"), icons.Server, "OpenAI-compatible endpoint", "Ollama, LM Studio, a proxy", "").Clicked() {
				*f = providerForm{chosen: true, listed: true, query: f.query}
			}
		})
	})
}

// choice is a row of the list of providers: its name, then what it is in
// the muted color, and where its key comes from now if it has one.
func choice(c *ui.Context, icon *ui.SVG, name, detail, source string) ui.Element {
	t := c.Theme()
	p := components.PaletteOf(t)
	row := ui.ButtonBase(c).Height(40).Padding(0, 12).Gap(8).AlignItems(ui.Center).FocusRing(false).
		Transition(components.ColorTransition).Label(name)
	if row.Hovered() {
		row.Background(p.Accent)
	}
	components.FocusRing(row, p, 0)
	row.Children(func() {
		if icon != nil {
			ui.Icon(c, icon).FontSize(16).TextColor(p.MutedForeground).Shrink(0)
		}
		ui.Text(c, name).FontWeight(500).SingleLine().Shrink(0)
		ui.Text(c, detail).FontSize(components.TextCode(t)).TextColor(p.MutedForeground).SingleLine().Shrink(1).Grow(1)
		if source != "" {
			components.Tag(c, source, p.MutedForeground)
		}
	})
	return row
}

func (a *App) keyFields(c *ui.Context, f *providerForm) {
	provider, _ := a.provider(f.provider)
	note := "Kept in ~/.ji/auth.json, where /login keeps keys; the terminal uses it too."
	if provider.Detected && !provider.Stored {
		note = provider.Source + " is set too; the key kept here is used in its place."
	}
	field(c, "Key", note, func() {
		input := components.TextInput(c, &f.key).Password().Placeholder("Paste the key").Label("API key").AutoFocus()
		if input.Submitted() && f.ready() {
			a.saveProviderForm()
		}
	})
}

func (a *App) endpointFields(c *ui.Context, f *providerForm) {
	t := c.Theme()
	p := components.PaletteOf(t)
	field(c, "Name", "", func() {
		input := components.TextInput(c, &f.name).Placeholder("Ollama").Label("Endpoint name")
		if f.editing == "" {
			input.AutoFocus()
		}
	})
	field(c, "Base URL", "Up to the version, where /models and /chat/completions are.", func() {
		components.TextInput(c, &f.baseURL).Placeholder("http://localhost:11434/v1").Label("Endpoint base URL")
	})
	keyNote := "Optional: a server on this Mac usually needs none."
	if f.stored {
		keyNote = "Leave it empty to keep the key stored."
	}
	field(c, "API key", keyNote, func() {
		components.TextInput(c, &f.key).Password().Placeholder("Paste the key").Label("Endpoint key")
	})

	ui.Column(c).Gap(8).Children(func() {
		ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
			ui.Column(c).Grow(1).Shrink(1).Gap(2).Children(func() {
				ui.Text(c, "Models").FontWeight(500)
				ui.Text(c, f.modelsNote()).FontSize(components.TextXS(t)).TextColor(p.MutedForeground)
			})
			label := "Fetch models"
			if f.probing {
				label = "Fetching…"
			}
			if components.Button(c, label, components.ButtonStyle{Variant: components.Outline, Size: components.SizeSmall, Icon: icons.RefreshCw, Disabled: f.probing || strings.TrimSpace(f.baseURL) == ""}).
				Tooltip("Ask the server which models it serves").Clicked() {
				a.probeEndpoint()
			}
		})
		if len(f.models) > 0 {
			ui.Column(c).Radius(t.Radius).Border(1, p.Border).Clip().Children(func() {
				ui.Scroll(c).MaxHeight(200).Children(func() {
					for i := range f.models {
						m := &f.models[i]
						modelCheck(c.Key(m.id), &m.kept, m.id)
					}
				})
			})
		}
		ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
			ui.Box(c).Grow(1).Shrink(1).Children(func() {
				if components.TextInput(c, &f.typed).Placeholder("Add a model id the list lacks").Label("Model id").Submitted() {
					f.addModel()
				}
			})
			if components.Button(c, "Add", components.ButtonStyle{Variant: components.Outline, Size: components.SizeSmall, Disabled: strings.TrimSpace(f.typed) == ""}).
				Label("Add the model id").Clicked() {
				f.addModel()
			}
		})
	})

	components.Disclosure(c, "Context window and thinking", ui.Color{}, &f.advanced, func() {
		ui.Row(c).Gap(16).AlignItems(ui.Center).Children(func() {
			ui.Column(c).Grow(1).Shrink(1).Gap(2).Children(func() {
				ui.Text(c, "Context window").FontWeight(500)
				ui.Text(c, "Tokens, the same for each model; unset, 256,000. Sessions compact at 80% of it, at most 200,000.").
					TextColor(p.MutedForeground)
			})
			ui.Box(c).Width(120).Shrink(0).Children(func() {
				components.TextInput(c, &f.window).Placeholder("256000").Label("Context window in tokens")
			})
		})
		modelCheck(c, &f.thinks, "The models think").Radius(t.Radius)
	})
}

// field is a labelled input: the label, what fn builds, then the note.
func field(c *ui.Context, label, note string, fn func()) {
	t := c.Theme()
	p := components.PaletteOf(t)
	ui.Column(c).Gap(6).Children(func() {
		ui.Text(c, label).FontWeight(500)
		fn()
		if note != "" {
			ui.Text(c, note).FontSize(components.TextXS(t)).TextColor(p.MutedForeground)
		}
	})
}

// notice is a line of what happened, after its icon, in its color.
func notice(c *ui.Context, icon *ui.SVG, color ui.Color, text string) {
	ui.Row(c).Gap(8).AlignItems(ui.Start).Children(func() {
		ui.Icon(c, icon).FontSize(14).Margin(2, 0, 0).TextColor(color).Shrink(0)
		ui.Text(c, text).TextColor(color).Shrink(1).Selectable()
	})
}

// modelCheck is a check box drawn as shadcn/ui's, before its label.
func modelCheck(c *ui.Context, checked *bool, label string) ui.Element {
	t := c.Theme()
	p := components.PaletteOf(t)
	row := ui.CheckboxBase(c, checked).Label(label).Height(32).Padding(0, 12).Gap(10).AlignItems(ui.Center).
		FocusRing(false).Transition(components.ColorTransition)
	if row.Hovered() {
		row.Background(p.Accent)
	}
	components.FocusRing(row, p, 0)
	row.Children(func() {
		box := ui.Row(c).Size(16, 16).Shrink(0).Radius(4).Border(1, p.Input).Justify(ui.Center).AlignItems(ui.Center).
			Transition(components.ColorTransition)
		if *checked {
			box.Border(1, p.Primary).Background(p.Primary)
		}
		box.Children(func() {
			if *checked {
				ui.Icon(c, icons.Check).FontSize(12).TextColor(p.PrimaryForeground)
			}
		})
		ui.Text(c, label).SingleLine().Shrink(1)
	})
	return row
}

// title is the form's heading; providerName names the provider whose key
// it takes.
func (f *providerForm) title(providerName string) string {
	switch {
	case !f.chosen:
		return "Add a provider"
	case f.provider != "":
		return providerName + " API key"
	case f.editing != "":
		return "Change " + f.name
	}
	return "OpenAI-compatible endpoint"
}

func (f *providerForm) saveLabel() string {
	switch {
	case f.saving:
		return "Saving…"
	case f.provider != "":
		return "Save key"
	case f.editing != "":
		return "Save changes"
	}
	return "Add endpoint"
}

func (f *providerForm) addModel() {
	id := strings.TrimSpace(f.typed)
	if id == "" {
		return
	}
	f.typed = ""
	for i := range f.models {
		if f.models[i].id == id {
			f.models[i].kept = true
			return
		}
	}
	f.models = append(f.models, modelChoice{id, true})
}

// keptModels is the models chosen, each with the window and thinking set.
func (f *providerForm) keptModels(window int) []agent.EndpointModel {
	var out []agent.EndpointModel
	for _, m := range f.models {
		if m.kept {
			out = append(out, agent.EndpointModel{ID: m.id, ContextWindow: window, Reasoning: f.thinks})
		}
	}
	return out
}

func (f *providerForm) modelsNote() string {
	if len(f.models) == 0 {
		return "Fetch the ones the server serves, or add their ids."
	}
	return fmt.Sprintf("%d of %d chosen: sessions can pick these.", f.keptCount(), len(f.models))
}

func (f *providerForm) keptCount() int {
	n := 0
	for _, m := range f.models {
		if m.kept {
			n++
		}
	}
	return n
}

func (f *providerForm) ready() bool {
	if f.saving {
		return false
	}
	if f.provider != "" {
		return strings.TrimSpace(f.key) != ""
	}
	return strings.TrimSpace(f.name) != "" && strings.TrimSpace(f.baseURL) != "" && f.keptCount() > 0
}

// probeEndpoint asks the server for its models; those it lists that the
// form lacks are added, all chosen unless there are many.
func (a *App) probeEndpoint() {
	f := a.adding
	f.probing, f.problem = true, ""
	baseURL, key, id := strings.TrimSpace(f.baseURL), strings.TrimSpace(f.key), f.editing
	a.request(func(ctx context.Context) {
		ids, err := a.agent.ProbeEndpoint(ctx, baseURL, key, id)
		a.update(func() {
			f.probing = false
			if err != nil {
				f.problem = err.Error()
				return
			}
			known := map[string]bool{}
			for _, m := range f.models {
				known[m.id] = true
			}
			keep := len(ids) <= fetchedKept
			for _, id := range ids {
				if !known[id] {
					f.models = append(f.models, modelChoice{id, keep})
				}
			}
		})
	})
}

func (a *App) saveProviderForm() {
	f := a.adding
	if f == nil || !f.ready() {
		return
	}
	f.problem = ""

	if f.provider != "" {
		provider, key, name := f.provider, strings.TrimSpace(f.key), a.providerName(f.provider)
		a.changeProviders(f, func(ctx context.Context) ([]agent.Provider, error) { return a.agent.StoreKey(ctx, provider, key) },
			name+"'s key is kept: its models are in the pickers.")
		return
	}

	window, ok := windowOf(f.window)
	if !ok {
		f.problem = "The context window is a number of tokens, as 131072."
		f.advanced = true
		return
	}
	e := agent.Endpoint{
		ID:      f.editing,
		Name:    strings.TrimSpace(f.name),
		BaseURL: strings.TrimSpace(f.baseURL),
		Key:     strings.TrimSpace(f.key),
		Models:  f.keptModels(window),
	}

	var note string
	switch {
	case f.editing != "":
		note = e.Name + " is changed."
	case len(e.Models) == 1:
		note = e.Name + " is added: its model is in the pickers."
	default:
		note = fmt.Sprintf("%s is added: its %d models are in the pickers.", e.Name, len(e.Models))
	}
	a.changeProviders(f, func(ctx context.Context) ([]agent.Provider, error) { return a.agent.KeepEndpoint(ctx, e) }, note)
}

// windowOf reads the context window typed in, as 131072 or 131,072; none
// typed is 0, the endpoint's default.
func windowOf(typed string) (int, bool) {
	w := strings.NewReplacer(",", "", "_", "", " ", "").Replace(typed)
	if w == "" {
		return 0, true
	}
	n, err := strconv.Atoi(w)
	if err != nil || n <= 0 {
		return 0, false
	}
	return n, true
}

// removeProvider forgets a provider's key or login, or removes an
// endpoint, once the person has said so a second time.
func (a *App) removeProvider(p agent.Provider) {
	change := func(ctx context.Context) ([]agent.Provider, error) { return a.agent.ForgetKey(ctx, p.ID) }
	if p.Endpoint != nil {
		change = func(ctx context.Context) ([]agent.Provider, error) { return a.agent.RemoveEndpoint(ctx, p.ID) }
	}
	a.changeProviders(nil, change, removalOf(p).done)
}

// removal is how taking a provider away is worded: what its button is
// called, the question its row then asks and the answer that does it, and
// what is said once it is done.
type removal struct {
	label, question, answer, done string
}

func removalOf(p agent.Provider) removal {
	switch {
	case p.Endpoint != nil:
		return removal{"Remove " + p.Name, "Remove it and its key?", "Remove", p.Name + " is removed."}
	case p.SignedIn():
		return removal{"Log out of " + p.Name, "Log out of it?", "Log out", "Logged out of " + p.Name + "."}
	}
	return removal{"Forget " + p.Name + "'s key", "Forget the key kept for it?", "Forget key", p.Name + "'s key is forgotten."}
}

// changeProviders makes a change of the providers and shows them as it
// leaves them. A form's problem goes in the form, which stays open; any
// other's under the heading.
func (a *App) changeProviders(f *providerForm, change func(context.Context) ([]agent.Provider, error), done string) {
	if f != nil {
		f.saving = true
	} else {
		a.removingBusy = true
	}
	a.request(func(ctx context.Context) {
		providers, err := change(ctx)
		a.update(func() {
			a.removingBusy = false
			if err != nil {
				if f != nil {
					f.saving, f.problem = false, err.Error()
				} else {
					a.providerNote = providerNote{text: err.Error(), failed: true}
				}
				return
			}
			if a.adding == f {
				a.adding = nil
			}
			a.removing = ""
			a.catalog.providers, a.catalog.listed, a.catalog.problem = providers, true, ""
			// An endpoint's models may have changed; the pickers read them again
			for _, p := range providers {
				if p.Endpoint != nil {
					delete(a.catalog.models, p.ID)
				}
			}
			a.providerNote = providerNote{text: done}
		})
	})
}

// confirmRemoval is the row's trail while it asks whether to remove: what
// goes, and the two answers, the one that removes in the destructive color.
func (a *App) confirmRemoval(c *ui.Context, p agent.Provider) {
	t := c.Theme()
	pal := components.PaletteOf(t)
	r := removalOf(p)
	ui.Text(c, r.question).FontSize(components.TextXS(t)).TextColor(pal.MutedForeground).SingleLine().Shrink(1)
	if components.Button(c, "Cancel", components.ButtonStyle{Variant: components.Ghost, Size: components.SizeExtraSmall}).
		Label("Keep " + p.Name).Clicked() {
		a.removing = ""
	}
	if components.Button(c, r.answer, components.ButtonStyle{Variant: components.Destructive, Size: components.SizeExtraSmall, Disabled: a.removingBusy}).
		Label(r.answer + ": " + p.Name).Clicked() {
		a.removeProvider(p)
	}
}

func (a *App) providerName(id string) string {
	if p, ok := a.provider(id); ok {
		return p.Name
	}
	return id
}

// hostOf is where an endpoint is, as its row shows it: the host and the
// path, without the scheme.
func hostOf(baseURL string) string {
	u, err := url.Parse(baseURL)
	if err != nil || u.Host == "" {
		return baseURL
	}
	return u.Host + strings.TrimSuffix(u.Path, "/")
}
