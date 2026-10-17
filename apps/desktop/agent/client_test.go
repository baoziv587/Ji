package agent

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestReadEventsParsesTheStream(t *testing.T) {
	stream := ": ping\n\n" +
		"id: 1\ndata: {\"seq\":1,\"type\":\"text\",\"delta\":\"hi\"}\n\n" +
		"id: 2\ndata: {\"seq\":2,\"type\":\"reply_end\"}\n\n"
	var got []Event
	err := readEvents(strings.NewReader(stream), func(raw json.RawMessage) {
		var e Event
		_ = json.Unmarshal(raw, &e)
		got = append(got, e)
	})

	if len(got) != 2 || got[0].Delta != "hi" || got[1].Type != "reply_end" {
		t.Errorf("events %+v", got)
	}
	if err == nil {
		t.Error("a stream that ends is a drop, to connect again after")
	}
}

func TestHelpReadsRowsAndLines(t *testing.T) {
	var e Event
	raw := `{"seq":4,"type":"help","sections":[{"title":"Commands","rows":[["/think","<off|high>  sets thinking"]]},{"title":"Mode","rows":"ask: before every command"}]}`
	if err := json.Unmarshal([]byte(raw), &e); err != nil {
		t.Fatal(err)
	}

	want := []HelpSection{
		{Title: "Commands", Rows: [][2]string{{"/think", "<off|high>  sets thinking"}}},
		{Title: "Mode", Text: "ask: before every command"},
	}
	if !reflect.DeepEqual(e.Sections, want) {
		t.Errorf("sections %+v", e.Sections)
	}
}

func TestAPendingClientWaitsForTheService(t *testing.T) {
	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"id":"s1"}`))
	}))
	defer service.Close()

	c := NewPendingClient()
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if _, err := c.CreateSession(ctx, "", ""); !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("asked before the service listens: %v, want it to wait", err)
	}

	go c.Connect(service.URL)
	if s, err := c.CreateSession(context.Background(), "", ""); err != nil || s.ID != "s1" {
		t.Errorf("asked once it listens: %+v, %v", s, err)
	}
}
