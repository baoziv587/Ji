package app

import (
	"reflect"
	"testing"
	"time"

	"github.com/egoist/mygo/ui"

	"desktop/agent"
)

// The model and thinking level are one button, which opens a picker of the
// detected providers' models: another provider shows its own, the filter
// narrows them, and a click switches the session to one; the picker stays
// for the levels that model takes, one of which closes it.
func TestModelPickerSwitchesTheSessionsModel(t *testing.T) {
	a, f := testApp()
	tt := ui.NewTester(a.View, 1100, 700)

	if err := tt.Click("Model"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	for _, text := range []string{"DeepSeek", "Groq", "DeepSeek Flash", "DeepSeek V4 Pro"} {
		if !tt.HasText(text) {
			t.Errorf("no %q in %q", text, tt.Texts())
		}
	}
	if tt.HasText("OpenAI") {
		t.Error("a provider without a key is offered")
	}

	if err := tt.Click("Groq"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if !tt.HasText("Llama 4 Scout") || tt.HasText("DeepSeek Flash") {
		t.Fatalf("Groq chosen shows %q", tt.Texts())
	}
	if err := tt.Click("Search models"); err != nil {
		t.Fatal(err)
	}
	tt.Type("qwen")
	tt.Frame()
	if tt.HasText("Llama 4 Scout") || !tt.HasText("Qwen3 32B") {
		t.Fatalf("filtered by qwen: %q", tt.Texts())
	}
	tt.Key(0, ui.KeyEnter)
	tt.Frame()

	if want := []string{"groq/qwen3-32b"}; !reflect.DeepEqual(f.models["a"], want) {
		t.Errorf("switched to %v, want %v", f.models["a"], want)
	}
	if !a.views["a"].models.open || a.views["a"].t.State.Model != "groq/qwen3-32b" ||
		!tt.HasText("This model does not think before it answers.") {
		t.Fatalf(
			"open %v, model %q, texts %q: the picker stays for the reasoning",
			a.views["a"].models.open,
			a.views["a"].t.State.Model,
			tt.Texts(),
		)
	}

	if err := tt.Click("DeepSeek"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if err := tt.Click("deepseek-v4-pro"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if !tt.HasText("Reasoning") || !tt.HasText("Low") {
		t.Fatalf("the levels of deepseek-v4-pro: %q", tt.Texts())
	}
	if err := tt.Click("Low"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if a.views["a"].models.open || !reflect.DeepEqual(f.thought, []string{"a low"}) {
		t.Errorf(
			"open %v, thought %v: a level closes the picker",
			a.views["a"].models.open,
			f.thought,
		)
	}
}

// While the session replies, its model stays as it is.
func TestModelPickerIsOffWhileReplying(t *testing.T) {
	a, f := testApp()
	a.apply(
		a.views["a"],
		agent.Event{
			Type: "state",
			State: &agent.State{
				ID:       "a",
				Model:    "deepseek/deepseek-flash",
				Mode:     "ask",
				Replying: true,
			},
		},
	)
	tt := ui.NewTester(a.View, 1100, 700)

	_ = tt.Click("Model")
	tt.Frame()

	if a.views["a"].models.open || tt.HasText("DeepSeek Flash") || len(f.models) != 0 {
		t.Errorf(
			"open %v, switched %v: the picker opens while replying",
			a.views["a"].models.open,
			f.models,
		)
	}
}

// The settings list the detected providers with where their key comes
// from, and the others folded, each with a /login where it has one.
func TestSettingsListProvidersAndLogIn(t *testing.T) {
	a, f := testApp()
	tt := ui.NewTester(a.View, 1100, 1600)
	a.settingsPage = pageModels
	a.OpenSettings()
	tt.Frame()

	for _, text := range []string{
		"Providers", "DeepSeek", "DEEPSEEK_API_KEY", "Groq",
		"stored credential", "Not detected (2)",
	} {
		if !tt.HasText(text) {
			t.Errorf("no %q in %q", text, tt.Texts())
		}
	}
	if tt.HasText("OpenAI") {
		t.Error("a provider not detected shows while its section is closed")
	}

	if err := tt.Click("Not detected (2)"); err != nil {
		t.Fatal(err)
	}
	// The section opens on the clock: its rows take clicks once it is open
	tt.Advance(400 * time.Millisecond)
	tt.Frame()
	if !tt.HasText("Amazon Bedrock") || !tt.HasText("Set up in the environment") {
		t.Fatalf("opened: %q", tt.Texts())
	}
	if err := tt.Click("Log in to OpenAI"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()

	if a.settingsOpen || !reflect.DeepEqual(f.commands["a"], []string{"/login openai"}) {
		t.Errorf(
			"open %v, commands %v: Log in runs /login in the session shown",
			a.settingsOpen,
			f.commands["a"],
		)
	}
}

// The settings choose the model new sessions start on, which a new session
// is created with; its X goes back to the service's own.
func TestDefaultModelIsWhatNewSessionsStartOn(t *testing.T) {
	a, f := testApp()
	var saved []Settings
	a.SaveSettings = func(s Settings) { saved = append(saved, s) }
	tt := ui.NewTester(a.View, 1100, 1600)
	a.settingsPage = pageModels
	a.OpenSettings()
	tt.Frame()

	if !tt.HasText("Service default") {
		t.Fatalf("no default shown in %q", tt.Texts())
	}
	if err := tt.Click("Choose the default model"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	tt.Frame()
	if !tt.HasText("DeepSeek Flash") {
		t.Fatalf("the picker opens on no provider: %q", tt.Texts())
	}
	if err := tt.Click("DeepSeek V4 Pro"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if a.Settings.Model != "deepseek/deepseek-v4-pro" || len(saved) == 0 ||
		saved[len(saved)-1].Model != "deepseek/deepseek-v4-pro" {
		t.Fatalf("model %q, saved %v", a.Settings.Model, saved)
	}

	a.NewSession("/code/web")
	sendDraft(a, "hello")
	a.OpenSettings()
	tt.Frame()
	if err := tt.Click("Use the service's model"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	a.NewSession("/code/web")
	sendDraft(a, "hello")

	if want := []string{
		"deepseek/deepseek-v4-pro high",
		"deepseek/deepseek-flash off",
	}; !reflect.DeepEqual(
		f.createdOn,
		want,
	) {
		t.Errorf("created on %v, want %v", f.createdOn, want)
	}
}

// A new session's model and thinking level are the service's to tell
// before there is a session: the levels are the model's, and the one
// picked is what the session is created at.
func TestNewSessionTakesTheModelsThinkingLevels(t *testing.T) {
	a, f := testApp()
	a.Settings.Model = "deepseek/deepseek-v4-pro"
	tt := ui.NewTester(a.View, 1100, 700)

	a.NewSession("/code/web")
	tt.Frame()
	st := &a.views[draftID].t.State
	if st.Thinking != "high" ||
		!reflect.DeepEqual(st.ThinkingLevels, []string{"off", "low", "high"}) ||
		!tt.HasText("v4-pro") {
		t.Fatalf("thinking %q of %v, texts %q", st.Thinking, st.ThinkingLevels, tt.Texts())
	}
	a.think(a.views[draftID], "low")
	a.useModel(a.views[draftID], "groq/qwen3-32b")
	if st.Thinking != "off" || len(st.ThinkingLevels) != 1 {
		t.Errorf(
			"thinking %q of %v: a model that does not reason takes off",
			st.Thinking,
			st.ThinkingLevels,
		)
	}
	a.useModel(a.views[draftID], "deepseek/deepseek-v4-pro")
	a.think(a.views[draftID], "low")
	sendDraft(a, "hello")

	if want := []string{"deepseek/deepseek-v4-pro low"}; !reflect.DeepEqual(f.createdOn, want) {
		t.Errorf("created on %v, want %v", f.createdOn, want)
	}
}
