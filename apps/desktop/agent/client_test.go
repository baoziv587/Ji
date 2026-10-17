package agent

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
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
