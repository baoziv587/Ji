// Package agentui is the window of Ji Agent: the coding agent's sessions,
// read from its HTTP service and drawn with MyGo's native UI.
package agentui

// The coding agent's HTTP service, as the window calls it: JSON for the
// state and the actions, Server-Sent Events for what happens
// (apps/coding-agent/src/server/http.ts lists the routes).

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
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
	// CreateSession starts a session in root; the service's default folder
	// when root is empty.
	CreateSession(ctx context.Context, root string) (Session, error)
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
	SwitchMode(ctx context.Context, id string) (State, error)
	Think(ctx context.Context, id, level string) (State, error)
	// Follow calls fn with every event of the session after seq, in order,
	// until ctx ends, connecting again after a drop.
	Follow(ctx context.Context, id string, after int, fn func(Event))
}

// Client is an Agent over HTTP.
type Client struct {
	base string
	http *http.Client
}

func NewClient(base string) *Client {
	return &Client{base: strings.TrimRight(base, "/"), http: &http.Client{}}
}

func sessionPath(id, action string) string {
	return "/api/sessions/" + url.PathEscape(id) + "/" + action
}

func (c *Client) FollowSessions(ctx context.Context, fn func(Sessions), status func(error)) {
	c.reconnect(ctx, "/api/events", nil, func(e json.RawMessage) {
		var s Sessions
		if json.Unmarshal(e, &s) == nil {
			fn(s)
		}
	}, status)
}

func (c *Client) CreateSession(ctx context.Context, root string) (Session, error) {
	var s Session
	return s, c.do(ctx, http.MethodPost, "/api/sessions", map[string]string{"root": root}, &s)
}

func (c *Client) Archive(ctx context.Context, id string, archived bool) (Session, error) {
	var s Session
	return s, c.do(ctx, http.MethodPost, sessionPath(id, "archive"), map[string]bool{"archived": archived}, &s)
}

func (c *Client) State(ctx context.Context, id string) (State, error) {
	var s State
	return s, c.do(ctx, http.MethodGet, sessionPath(id, "state"), nil, &s)
}

func (c *Client) Send(ctx context.Context, id, text string) (string, error) {
	var out struct {
		Result string `json:"result"`
	}
	err := c.do(ctx, http.MethodPost, sessionPath(id, "messages"), map[string]string{"text": text}, &out)
	return out.Result, err
}

func (c *Client) Command(ctx context.Context, id, line string) (string, error) {
	var out struct {
		Result string `json:"result"`
	}
	err := c.do(ctx, http.MethodPost, sessionPath(id, "commands"), map[string]string{"line": line}, &out)
	return out.Result, err
}

func (c *Client) Answer(ctx context.Context, id, question string, answers [][]string) error {
	var body any = map[string]any{"answers": answers}
	if answers == nil {
		body = map[string]any{"dismissed": true}
	}
	return c.do(ctx, http.MethodPost, sessionPath(id, "questions/"+url.PathEscape(question)), body, nil)
}

func (c *Client) Stop(ctx context.Context, id string) error {
	return c.do(ctx, http.MethodPost, sessionPath(id, "stop"), nil, nil)
}

func (c *Client) SwitchMode(ctx context.Context, id string) (State, error) {
	var s State
	return s, c.do(ctx, http.MethodPost, sessionPath(id, "mode"), nil, &s)
}

func (c *Client) Think(ctx context.Context, id, level string) (State, error) {
	var s State
	return s, c.do(ctx, http.MethodPost, sessionPath(id, "thinking"), map[string]string{"level": level}, &s)
}

func (c *Client) Follow(ctx context.Context, id string, after int, fn func(Event)) {
	c.reconnect(ctx, sessionPath(id, "events"), &after, func(raw json.RawMessage) {
		var e Event
		if json.Unmarshal(raw, &e) == nil {
			if e.Seq > after {
				after = e.Seq
			}
			fn(e)
		}
	}, func(error) {})
}

// reconnect reads a stream until ctx ends, connecting again a second after
// each drop; after, when given, says from where.
func (c *Client) reconnect(ctx context.Context, path string, after *int, fn func(json.RawMessage), status func(error)) {
	for ctx.Err() == nil {
		err := c.stream(ctx, path, after, fn, status)
		if ctx.Err() != nil {
			return
		}
		status(err)
		select {
		case <-ctx.Done():
		case <-time.After(time.Second):
		}
	}
}

// stream reads one connection's events until it drops.
func (c *Client) stream(ctx context.Context, path string, after *int, fn func(json.RawMessage), status func(error)) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "text/event-stream")
	if after != nil {
		req.Header.Set("Last-Event-ID", strconv.Itoa(*after))
	}
	res, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("%s: %s", path, res.Status)
	}
	status(nil)
	return readEvents(res.Body, fn)
}

// readEvents parses a Server-Sent Events stream: each event's data is one
// JSON value; comments and other fields are skipped.
func readEvents(r io.Reader, fn func(json.RawMessage)) error {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 64*1024), 16*1024*1024)
	var data strings.Builder
	for scanner.Scan() {
		line := scanner.Text()
		switch {
		case line == "":
			if data.Len() > 0 {
				fn(json.RawMessage(data.String()))
				data.Reset()
			}
		case strings.HasPrefix(line, "data:"):
			if data.Len() > 0 {
				data.WriteByte('\n')
			}
			data.WriteString(strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	return io.ErrUnexpectedEOF
}

func (c *Client) do(ctx context.Context, method, path string, body, out any) error {
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()

	if res.StatusCode >= 400 {
		var e struct {
			Error string `json:"error"`
		}
		if json.NewDecoder(res.Body).Decode(&e) == nil && e.Error != "" {
			return fmt.Errorf("%s", e.Error)
		}
		return fmt.Errorf("%s %s: %s", method, path, res.Status)
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(res.Body).Decode(out)
}
