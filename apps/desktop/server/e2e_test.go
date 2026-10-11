package server

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"desktop/agent"
	"desktop/conversation"
)

// TestEndToEnd starts the real service with a real model, asks a new session
// for a file, approves the command, then starts the service again and reads
// the session back from its log: JI_AGENT_E2E=1, with a key for the model
// (JI_AGENT_MODEL, the service's default without it).
func TestEndToEnd(t *testing.T) {
	if os.Getenv("JI_AGENT_E2E") != "1" {
		t.Skip("JI_AGENT_E2E is not set")
	}
	root, sessions := t.TempDir(), t.TempDir()
	options := Options{Root: root, Sessions: sessions, Model: os.Getenv("JI_AGENT_MODEL"), Thinking: "low"}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	// A session, its command approved
	server, err := Start(options)
	if err != nil {
		t.Fatal(err)
	}
	client := agent.NewClient(server.URL)
	session, err := client.CreateSession(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	events := make(chan agent.Event, 1024)
	following, stopFollowing := context.WithCancel(ctx)
	go client.Follow(following, session.ID, 0, func(e agent.Event) { events <- e })
	if _, err := client.Send(ctx, session.ID, "Use the bash tool to run exactly: echo hi > hello.txt. Then reply with the single word: done"); err != nil {
		t.Fatal(err)
	}
	for e := range events {
		t.Logf("event %d %s %s%s%s", e.Seq, e.Type, e.Name, e.Delta, e.Error)
		if e.Type == "ask" {
			if err := client.Answer(ctx, session.ID, e.ID, [][]string{{"yes"}}); err != nil {
				t.Fatal(err)
			}
		}
		if e.Type == "reply_end" {
			if e.Outcome != "done" {
				t.Fatalf("reply %s: %s", e.Outcome, e.Error)
			}
			break
		}
	}
	stopFollowing()
	if b, err := os.ReadFile(filepath.Join(root, "hello.txt")); err != nil || string(b) != "hi\n" {
		t.Fatalf("hello.txt %q, %v", b, err)
	}
	server.Stop()

	// The same session, read back by a new service
	server, err = Start(options)
	if err != nil {
		t.Fatal(err)
	}
	defer server.Stop()
	client = agent.NewClient(server.URL)
	listed := make(chan agent.Sessions, 1)
	listing, stopListing := context.WithCancel(ctx)
	go client.FollowSessions(listing, func(s agent.Sessions) {
		select {
		case listed <- s:
		default:
		}
	}, func(error) {})
	list := <-listed
	stopListing()
	if len(list.Sessions) != 1 || list.Sessions[0].ID != session.ID || !strings.HasPrefix(list.Sessions[0].Title, "Use the bash tool") {
		t.Fatalf("listed %+v", list.Sessions)
	}

	var tr conversation.Transcript
	replayed := make(chan agent.Event, 1024)
	go client.Follow(ctx, session.ID, 0, func(e agent.Event) { replayed <- e })
	for e := range replayed {
		tr.Apply(e)
		if e.Type == "reply_end" {
			break
		}
	}
	if len(tr.Items) == 0 || tr.Items[0].Kind != conversation.KindUser {
		t.Fatalf("replayed items %+v", tr.Items)
	}
	var ran bool
	for _, it := range tr.Items {
		ran = ran || (it.Kind == conversation.KindTool && it.Tool.Name == "bash" && it.Tool.OK)
	}
	if !ran {
		t.Errorf("the replayed session shows no bash call: %+v", tr.Items)
	}
}
