package agent

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

// Client is an Agent over HTTP.
type Client struct {
	base  string
	ready chan struct{}
	http  *http.Client
}

func NewClient(base string) *Client {
	c := NewPendingClient()
	c.Connect(base)
	return c
}

// NewPendingClient is a Client of a service that does not listen yet: what
// is asked of it waits until Connect says where it does.
func NewPendingClient() *Client {
	return &Client{ready: make(chan struct{}), http: &http.Client{}}
}

// Connect says where the service listens, once.
func (c *Client) Connect(base string) {
	c.base = strings.TrimRight(base, "/")
	close(c.ready)
}

// url is where path is, once the service listens.
func (c *Client) url(ctx context.Context, path string) (string, error) {
	select {
	case <-c.ready:
		return c.base + path, nil
	case <-ctx.Done():
		return "", ctx.Err()
	}
}

func sessionPath(id, action string) string {
	return "/api/sessions/" + url.PathEscape(id) + "/" + action
}

func providerPath(id, action string) string {
	return "/api/providers/" + url.PathEscape(id) + "/" + action
}

func (c *Client) FollowSessions(ctx context.Context, fn func(Sessions), status func(error)) {
	c.reconnect(ctx, "/api/events", nil, func(e json.RawMessage) {
		var s Sessions
		if json.Unmarshal(e, &s) == nil {
			fn(s)
		}
	}, status)
}

func (c *Client) CreateSession(ctx context.Context, root, model string) (Session, error) {
	var s Session
	return s, c.do(
		ctx,
		http.MethodPost,
		"/api/sessions",
		map[string]string{"root": root, "model": model},
		&s,
	)
}

func (c *Client) Archive(ctx context.Context, id string, archived bool) (Session, error) {
	var s Session
	return s, c.do(
		ctx,
		http.MethodPost,
		sessionPath(id, "archive"),
		map[string]bool{"archived": archived},
		&s,
	)
}

func (c *Client) State(ctx context.Context, id string) (State, error) {
	var s State
	return s, c.do(ctx, http.MethodGet, sessionPath(id, "state"), nil, &s)
}

func (c *Client) Send(ctx context.Context, id, text string) (string, error) {
	var out struct {
		Result string `json:"result"`
	}
	err := c.do(
		ctx,
		http.MethodPost,
		sessionPath(id, "messages"),
		map[string]string{"text": text},
		&out,
	)
	return out.Result, err
}

func (c *Client) Command(ctx context.Context, id, line string) (string, error) {
	var out struct {
		Result string `json:"result"`
	}
	err := c.do(
		ctx,
		http.MethodPost,
		sessionPath(id, "commands"),
		map[string]string{"line": line},
		&out,
	)
	return out.Result, err
}

func (c *Client) Answer(ctx context.Context, id, question string, answers [][]string) error {
	var body any = map[string]any{"answers": answers}
	if answers == nil {
		body = map[string]any{"dismissed": true}
	}
	return c.do(
		ctx,
		http.MethodPost,
		sessionPath(id, "questions/"+url.PathEscape(question)),
		body,
		nil,
	)
}

func (c *Client) Stop(ctx context.Context, id string) error {
	return c.do(ctx, http.MethodPost, sessionPath(id, "stop"), nil, nil)
}

func (c *Client) SetMode(ctx context.Context, id, mode string) (State, error) {
	var s State
	return s, c.do(
		ctx,
		http.MethodPost,
		sessionPath(id, "mode"),
		map[string]string{"mode": mode},
		&s,
	)
}

func (c *Client) SetModes(ctx context.Context, mode string) error {
	return c.do(ctx, http.MethodPost, "/api/mode", map[string]string{"mode": mode}, nil)
}

func (c *Client) Think(ctx context.Context, id, level string) (State, error) {
	var s State
	return s, c.do(
		ctx,
		http.MethodPost,
		sessionPath(id, "thinking"),
		map[string]string{"level": level},
		&s,
	)
}

func (c *Client) UseModel(ctx context.Context, id, model string) (State, error) {
	var s State
	return s, c.do(
		ctx,
		http.MethodPost,
		sessionPath(id, "model"),
		map[string]string{"model": model},
		&s,
	)
}

func (c *Client) Providers(ctx context.Context) ([]Provider, error) {
	return c.providers(ctx, http.MethodGet, "/api/providers", nil)
}

func (c *Client) Models(ctx context.Context, provider string) ([]Model, error) {
	var out struct {
		Models []Model `json:"models"`
	}
	err := c.do(ctx, http.MethodGet, providerPath(provider, "models"), nil, &out)
	return out.Models, err
}

func (c *Client) StoreKey(ctx context.Context, provider, key string) ([]Provider, error) {
	return c.providers(
		ctx,
		http.MethodPut,
		providerPath(provider, "key"),
		map[string]string{"key": key},
	)
}

func (c *Client) ForgetKey(ctx context.Context, provider string) ([]Provider, error) {
	return c.providers(ctx, http.MethodDelete, providerPath(provider, "key"), nil)
}

func (c *Client) KeepEndpoint(ctx context.Context, e Endpoint) ([]Provider, error) {
	return c.providers(ctx, http.MethodPost, "/api/endpoints", e)
}

func (c *Client) RemoveEndpoint(ctx context.Context, id string) ([]Provider, error) {
	return c.providers(ctx, http.MethodDelete, "/api/endpoints/"+url.PathEscape(id), nil)
}

func (c *Client) ProbeEndpoint(ctx context.Context, baseURL, key, id string) ([]string, error) {
	var out struct {
		Models []string `json:"models"`
	}
	err := c.do(
		ctx,
		http.MethodPost,
		"/api/endpoints/probe",
		map[string]string{"baseUrl": baseURL, "key": key, "id": id},
		&out,
	)
	return out.Models, err
}

// providers makes a change that answers with the providers after it.
func (c *Client) providers(ctx context.Context, method, path string, body any) ([]Provider, error) {
	var out struct {
		Providers []Provider `json:"providers"`
	}
	err := c.do(ctx, method, path, body, &out)
	return out.Providers, err
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
func (c *Client) reconnect(
	ctx context.Context,
	path string,
	after *int,
	fn func(json.RawMessage),
	status func(error),
) {
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
func (c *Client) stream(
	ctx context.Context,
	path string,
	after *int,
	fn func(json.RawMessage),
	status func(error),
) error {
	u, err := c.url(ctx, path)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
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
// JSON value; comments and other fields are skipped. The data handed to fn
// is read into one buffer, used again for the next event, so fn must not
// keep it: a write's arguments, a whole file, would otherwise be copied
// three times over.
func readEvents(r io.Reader, fn func(json.RawMessage)) error {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 64*1024), 16*1024*1024)
	var data []byte
	for scanner.Scan() {
		line := scanner.Bytes()
		switch {
		case len(line) == 0:
			if len(data) > 0 {
				fn(data)
				data = data[:0]
			}
		case bytes.HasPrefix(line, dataField):
			if len(data) > 0 {
				data = append(data, '\n')
			}
			value := bytes.TrimPrefix(bytes.TrimPrefix(line, dataField), []byte(" "))
			data = append(data, value...)
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	return io.ErrUnexpectedEOF
}

var dataField = []byte("data:")

func (c *Client) do(ctx context.Context, method, path string, body, out any) error {
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(b)
	}
	u, err := c.url(ctx, path)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, method, u, reader)
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
