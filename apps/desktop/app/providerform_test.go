package app

import (
	"reflect"
	"testing"
	"time"

	"github.com/egoist/mygo/ui"

	"desktop/agent"
)

// settingsTester is the settings open on the providers.
func settingsTester(t *testing.T) (*App, *fakeAgent, *ui.Tester) {
	t.Helper()
	a, f := testApp()
	tt := ui.NewTester(a.View, 1100, 1600)
	a.settingsPage = pageModels
	a.OpenSettings()
	tt.Frame()
	return a, f, tt
}

func click(t *testing.T, tt *ui.Tester, s string) {
	t.Helper()
	if err := tt.Click(s); err != nil {
		t.Fatalf("%v in %q", err, tt.Texts())
	}
	tt.Frame()
}

// A key typed in for a provider not detected is stored, and the provider
// shows as detected with it.
func TestAKeyAddedInTheSettingsIsStored(t *testing.T) {
	a, f, tt := settingsTester(t)

	click(t, tt, "Not detected (2)")
	// The section opens on the clock: its rows take clicks once it is open
	time.Sleep(400 * time.Millisecond)
	tt.Frame()
	click(t, tt, "Add a key for OpenAI")
	if !tt.HasText("OpenAI API key") {
		t.Fatalf("no form for the key: %q", tt.Texts())
	}
	click(t, tt, "API key")
	tt.Type("sk-typed")
	click(t, tt, "Save key")

	if f.keys["openai"] != "sk-typed" {
		t.Errorf("keys %v", f.keys)
	}
	if a.adding != nil || !tt.HasText("OpenAI's key is kept: its models are in the pickers.") {
		t.Errorf("form %v, texts %q", a.adding, tt.Texts())
	}
	if p, _ := a.provider("openai"); !p.Detected {
		t.Errorf("openai %+v is not detected after its key is kept", p)
	}
}

// An endpoint is added with the models its server lists, all chosen when
// they are few, and one typed in.
func TestAnEndpointIsAddedWithTheModelsItServes(t *testing.T) {
	a, f, tt := settingsTester(t)
	f.probed = []string{"llama3", "qwen2.5-coder"}

	click(t, tt, "Add provider")
	click(t, tt, "OpenAI-compatible endpoint")
	click(t, tt, "Endpoint name")
	tt.Type("Local LLM")
	click(t, tt, "Endpoint base URL")
	tt.Type("http://localhost:11434/v1")
	click(t, tt, "Fetch models")
	if !tt.HasText("2 of 2 chosen: sessions can pick these.") {
		t.Fatalf("not fetched: %q", tt.Texts())
	}
	click(t, tt, "qwen2.5-coder")
	click(t, tt, "Model id")
	tt.Type("mistral-small")
	click(t, tt, "Add the model id")
	click(t, tt, "Add endpoint")

	want := agent.Endpoint{Name: "Local LLM", BaseURL: "http://localhost:11434/v1", Models: []agent.EndpointModel{{ID: "llama3"}, {ID: "mistral-small"}}}
	if len(f.endpoints) != 1 || !reflect.DeepEqual(f.endpoints[0], want) {
		t.Fatalf("kept %+v, want %+v", f.endpoints, want)
	}
	if a.adding != nil || !tt.HasText("localhost:11434/v1") {
		t.Errorf("form %v, texts %q", a.adding, tt.Texts())
	}
}

// What the server cannot answer is said in the form, which stays open.
func TestAnEndpointThatCannotBeReachedSaysSo(t *testing.T) {
	a, _, tt := settingsTester(t)

	click(t, tt, "Add provider")
	click(t, tt, "OpenAI-compatible endpoint")
	click(t, tt, "Endpoint base URL")
	tt.Type("http://localhost:1/v1")
	click(t, tt, "Fetch models")

	if a.adding == nil || !tt.HasText("could not reach http://localhost:1/v1/models: ECONNREFUSED") {
		t.Errorf("texts %q", tt.Texts())
	}
	tt.Key(0, ui.KeyEscape)
	tt.Frame()
	if a.adding != nil || !a.settingsOpen {
		t.Errorf("Esc closes the form first: form %v, settings open %v", a.adding, a.settingsOpen)
	}
}

// An endpoint's window, unset, is left to the service; set, it goes with
// each model, and a word in it is refused before anything is sent.
func TestAnEndpointsContextWindowIsANumber(t *testing.T) {
	_, f, tt := settingsTester(t)

	click(t, tt, "Add provider")
	click(t, tt, "OpenAI-compatible endpoint")
	click(t, tt, "Endpoint name")
	tt.Type("Proxy")
	click(t, tt, "Endpoint base URL")
	tt.Type("https://llm.example.com/v1")
	click(t, tt, "Model id")
	tt.Type("gpt-oss")
	click(t, tt, "Add the model id")
	click(t, tt, "Context window and thinking")
	time.Sleep(400 * time.Millisecond)
	tt.Frame()
	click(t, tt, "Context window in tokens")
	tt.Type("lots")
	click(t, tt, "Add endpoint")
	if len(f.endpoints) != 0 || !tt.HasText("The context window is a number of tokens, as 131072.") {
		t.Fatalf("kept %v, texts %q", f.endpoints, tt.Texts())
	}
}

// Removing asks again in the row, and only the second yes removes.
func TestRemovingAnEndpointAsksInItsRow(t *testing.T) {
	a, f, tt := settingsTester(t)
	f.providers = append(append([]agent.Provider{}, testProviders...), agent.Provider{
		ID: "local-llm", Name: "Local LLM", Detected: true, Source: "no key", APIKey: true, Models: 1,
		Endpoint: &agent.Endpoint{BaseURL: "http://localhost:11434/v1", Models: []agent.EndpointModel{{ID: "llama3"}}},
	})
	a.loadProviders()
	tt.Frame()

	click(t, tt, "Remove Local LLM")
	if len(f.removed) != 0 || !tt.HasText("Remove it and its key?") {
		t.Fatalf("removed %v at once, texts %q", f.removed, tt.Texts())
	}
	click(t, tt, "Keep Local LLM")
	if a.removing != "" {
		t.Fatal("Cancel leaves it asking")
	}
	click(t, tt, "Remove Local LLM")
	click(t, tt, "Remove: Local LLM")

	if !reflect.DeepEqual(f.removed, []string{"local-llm"}) || tt.HasText("Local LLM") && !tt.HasText("Local LLM is removed.") {
		t.Errorf("removed %v, texts %q", f.removed, tt.Texts())
	}
}

// A key from the environment has nothing to forget; a stored one has.
func TestOnlyAStoredKeyCanBeForgotten(t *testing.T) {
	_, f, tt := settingsTester(t)

	if _, ok := tt.Find("Forget DeepSeek's key"); ok {
		t.Error("DEEPSEEK_API_KEY is the environment's, not ours to forget")
	}
	click(t, tt, "Forget Groq's key")
	click(t, tt, "Forget key: Groq")
	if !reflect.DeepEqual(f.removed, []string{"groq"}) || !tt.HasText("Groq's key is forgotten.") {
		t.Errorf("removed %v, texts %q", f.removed, tt.Texts())
	}
}

// The gear opens the settings with the providers read, as ⌘, does, on
// whichever page.
func TestTheGearReadsTheProviders(t *testing.T) {
	a, _ := testApp()
	tt := ui.NewTester(a.View, 1100, 1600)
	tt.Frame()

	click(t, tt, "Settings")
	if !a.catalog.listed {
		t.Fatal("the providers are not read on the first page")
	}
	click(t, tt, "Models")

	if !a.settingsOpen || !a.catalog.listed || !tt.HasText("DEEPSEEK_API_KEY") {
		t.Errorf("open %v, listed %v, texts %q", a.settingsOpen, a.catalog.listed, tt.Texts())
	}
}
