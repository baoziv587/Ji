// Package agent is the coding agent's HTTP service as the window sees it:
// what it says, sessions, their state and events, and what the window asks
// of it.
package agent

import (
	"context"
	"encoding/json"
)

// Session is one line of the list: a conversation working in a folder.
type Session struct {
	ID    string `json:"id"`
	Root  string `json:"root"`
	Title string `json:"title"`
	// Milliseconds since the epoch.
	Created  int64 `json:"created"`
	Updated  int64 `json:"updated"`
	Archived bool  `json:"archived"`
	// idle, running, asking or failed.
	Status string `json:"status"`
}

// Sessions is the list, and where a session goes when no folder is named.
type Sessions struct {
	Sessions    []Session `json:"sessions"`
	DefaultRoot string    `json:"defaultRoot"`
}

// State is everything the window shows around a session's conversation.
type State struct {
	ID             string   `json:"id"`
	Root           string   `json:"root"`
	Model          string   `json:"model"`
	Thinking       string   `json:"thinking"`
	ThinkingLevels []string `json:"thinkingLevels"`
	// OpenAI's priority tier, switched with /fast.
	Fast     bool     `json:"fast"`
	Mode     string   `json:"mode"`
	Allowed  string   `json:"allowed"`
	Replying bool     `json:"replying"`
	Queued   int      `json:"queued"`
	Tools    []string `json:"tools"`
	Asking   []string `json:"asking"`
	Outcome  string   `json:"outcome,omitempty"`
	// The commands typed after a `/`, built-in ones first.
	Commands []Command `json:"commands"`
	// What the session has spent so far, and how much the history holds.
	Usage UsageReading `json:"usage"`
}

// Command is one of the commands typed after a `/`, as in the terminal.
type Command struct {
	Name string `json:"name"`
	// What it takes after its name, as `<off|high>`; none when it takes
	// nothing.
	Arg   string `json:"arg,omitempty"`
	Hint  string `json:"hint"`
	Group string `json:"group,omitempty"`
	// What it takes, when that is one of a few.
	Choices []string `json:"choices,omitempty"`
}

// UsageReading is what a session has spent, as the terminal's usage line
// shows it.
type UsageReading struct {
	// The history's size against where it is compacted; nil until the
	// model has answered once.
	Context *ContextSize `json:"context,omitempty"`
	Cost    float64      `json:"cost"`
	Input   int          `json:"input"`
	Output  int          `json:"output"`
	// The share of the input that came from the cache, in percent.
	Cache int `json:"cache"`
	// Output tokens a second; 0 until a call is timed.
	Speed float64 `json:"speed,omitempty"`
	Calls int     `json:"calls"`
}

// ContextSize is the history's tokens, an estimate after a compaction until
// the model counts them, and where it is compacted.
type ContextSize struct {
	Tokens    int  `json:"tokens"`
	Estimated bool `json:"estimated"`
	Limit     int  `json:"limit"`
}

// HelpSection is a part of what /help lists: rows of a key and what it
// does, or a line of text.
type HelpSection struct {
	Title string
	Rows  [][2]string
	Text  string
}

func (h *HelpSection) UnmarshalJSON(b []byte) error {
	var raw struct {
		Title string          `json:"title"`
		Rows  json.RawMessage `json:"rows"`
	}
	if err := json.Unmarshal(b, &raw); err != nil {
		return err
	}
	h.Title = raw.Title
	if json.Unmarshal(raw.Rows, &h.Text) == nil {
		return nil
	}
	return json.Unmarshal(raw.Rows, &h.Rows)
}

// Provider is one of the catalog's providers, and whether a model of it
// can be used now.
type Provider struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// It has a key now: in the environment, kept by /login, or a sign-in.
	Detected bool `json:"detected"`
	// Where the key comes from, as DEEPSEEK_API_KEY or "stored credential";
	// none when not detected.
	Source string `json:"source,omitempty"`
	// Whether /login signs in to it.
	Login bool `json:"login"`
	// Whether a key can be typed in for it, as StoreKey does, and whether
	// /login can sign in to it in the browser.
	APIKey bool `json:"apiKey"`
	OAuth  bool `json:"oauth"`
	// Whether what it has, a key or a login, is kept in ~/.ji, so that
	// ForgetKey forgets it.
	Stored bool `json:"stored"`
	// How many chat models it offers.
	Models int `json:"models"`
	// Set for an endpoint the person added.
	Endpoint *Endpoint `json:"endpoint,omitempty"`
}

// SignedIn is whether its key is an OAuth login, which /logout forgets.
func (p Provider) SignedIn() bool { return p.Source == "OAuth" }

// Keyless is whether it is asked with no key: an endpoint that has none.
func (p Provider) Keyless() bool { return p.Source == "no key" }

// Endpoint is a server that speaks OpenAI's chat completions, added as a
// provider. Its ID is made of its name when it is added.
type Endpoint struct {
	ID      string `json:"id,omitempty"`
	Name    string `json:"name,omitempty"`
	BaseURL string `json:"baseUrl"`
	// Sent to be stored; never sent back. Empty keeps the stored one.
	Key    string          `json:"key,omitempty"`
	Models []EndpointModel `json:"models"`
}

// EndpointModel is a model of an endpoint. Unset, the window is the
// service's default and the model does not think.
type EndpointModel struct {
	ID            string `json:"id"`
	ContextWindow int    `json:"contextWindow,omitempty"`
	Reasoning     bool   `json:"reasoning,omitempty"`
}

// Model is one of a provider's chat models.
type Model struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	ContextWindow int    `json:"contextWindow"`
	Reasoning     bool   `json:"reasoning"`
}

// Option is one answer a question offers.
type Option struct {
	Value string `json:"value"`
	Label string `json:"label"`
	Hint  string `json:"hint,omitempty"`
}

// Question is one of the questions the agent asks at once: whether a call
// may run, or one of the model's own.
type Question struct {
	Title    string   `json:"title"`
	Detail   string   `json:"detail,omitempty"`
	Options  []Option `json:"options"`
	Multiple bool     `json:"multiple"`
	Other    bool     `json:"other"`
	Initial  string   `json:"initial,omitempty"`
	// What the typed answer is for, and whether it is a key, shown as dots.
	Placeholder string `json:"placeholder,omitempty"`
	Secret      bool   `json:"secret,omitempty"`
}

// Usage is what a reply spent.
type Usage struct {
	Input  int     `json:"input"`
	Output int     `json:"output"`
	Cost   float64 `json:"cost"`
}

// Event is one event of a session; which fields it has depends on Type.
type Event struct {
	Seq  int    `json:"seq"`
	Type string `json:"type"`

	Text  string `json:"text,omitempty"`
	Steer bool   `json:"steer,omitempty"`
	Delta string `json:"delta,omitempty"`

	ID     string `json:"id,omitempty"`
	Name   string `json:"name,omitempty"`
	Args   string `json:"args,omitempty"`
	OK     bool   `json:"ok,omitempty"`
	Output string `json:"output,omitempty"`
	MS     int    `json:"ms,omitempty"`

	Tool      string     `json:"tool,omitempty"`
	Outside   bool       `json:"outside,omitempty"`
	Questions []Question `json:"questions,omitempty"`

	// A compaction's size before and after; Tokens as it starts.
	Tokens int `json:"tokens,omitempty"`
	Before int `json:"before,omitempty"`
	After  int `json:"after,omitempty"`

	Outcome string `json:"outcome,omitempty"`
	Error   string `json:"error,omitempty"`
	Unsent  string `json:"unsent,omitempty"`
	Usage   *Usage `json:"usage,omitempty"`

	State *State `json:"state,omitempty"`

	// A notice's level: info, success, warn or error; Text says it.
	Level string `json:"level,omitempty"`
	// What /help lists.
	Sections []HelpSection `json:"sections,omitempty"`
}

// Agent is what the window needs of the service; a fake stands in for it in
// the tests.
type Agent interface {
	// FollowSessions calls fn with the list at once and whenever it changes,
	// until ctx ends, connecting again after a drop; status reports each
	// connection and drop.
	FollowSessions(ctx context.Context, fn func(Sessions), status func(error))
	// CreateSession starts a session in root, on model, "provider/id"; the
	// service's default folder and model for those left empty.
	CreateSession(ctx context.Context, root, model string) (Session, error)
	Archive(ctx context.Context, id string, archived bool) (Session, error)

	State(ctx context.Context, id string) (State, error)
	// Send starts a reply, or steers the one in progress: "started" or
	// "steered".
	Send(ctx context.Context, id, text string) (string, error)
	// Command runs the command a line names, as the terminal does: "ran",
	// or what Send says for a skill's, which goes to the model.
	Command(ctx context.Context, id, line string) (string, error)
	// Answer replies to a question: one list of values per question, or nil
	// to dismiss them.
	Answer(ctx context.Context, id, question string, answers [][]string) error
	Stop(ctx context.Context, id string) error
	// SetMode sets a session's mode: ask, auto or yolo.
	SetMode(ctx context.Context, id, mode string) (State, error)
	// SetModes sets every session's mode, those started later included.
	SetModes(ctx context.Context, mode string) error
	Think(ctx context.Context, id, level string) (State, error)
	// UseModel switches a session to a model, "provider/id", for its next
	// reply; refused while it replies.
	UseModel(ctx context.Context, id, model string) (State, error)
	// Providers is every provider of the catalog, the detected ones marked.
	Providers(ctx context.Context) ([]Provider, error)
	// Models is a provider's chat models.
	Models(ctx context.Context, provider string) ([]Model, error)
	// StoreKey keeps a provider's key in ~/.ji, as /login does; it is
	// used in place of the environment's. Each change returns the
	// providers as they are after it.
	StoreKey(ctx context.Context, provider, key string) ([]Provider, error)
	// ForgetKey forgets the key or login kept, as /logout does.
	ForgetKey(ctx context.Context, provider string) ([]Provider, error)
	// KeepEndpoint adds an endpoint, or changes the one of its ID.
	KeepEndpoint(ctx context.Context, e Endpoint) ([]Provider, error)
	RemoveEndpoint(ctx context.Context, id string) ([]Provider, error)
	// ProbeEndpoint is the model ids the server at baseURL lists, asked
	// with key, or the stored key of endpoint id when key is empty.
	ProbeEndpoint(ctx context.Context, baseURL, key, id string) ([]string, error)
	// Follow calls fn with every event of the session after seq, in order,
	// until ctx ends, connecting again after a drop.
	Follow(ctx context.Context, id string, after int, fn func(Event))
}
