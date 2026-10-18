// Package server starts the coding agent's HTTP service, when no address
// of a running one is given: node runs apps/coding-agent/src/server.ts, or the
// bundle of it an installed app carries, and the line it prints once it
// listens says where. Shared, it is this machine's one service, the
// terminal's too: one already running is used, and one started here outlives
// the app, ending once nothing has used it for a while. Otherwise it is the
// app's own, on a free port, and ends with it.
package server

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

const serverScript = "apps/coding-agent/src/server.ts"

// Options is what the service is started with.
type Options struct {
	// Script is server.ts; found from the working directory or the
	// executable when empty, else Bundled.
	Script string
	// Bundled is the service bundled into the app (`pnpm desktop:bundle-agent`),
	// for an app installed away from the repository.
	Bundled string
	// Node runs it; the node in PATH when empty.
	Node string
	// Root is where a new session works when no folder is chosen.
	Root string
	// Sessions is where the service keeps them; ~/.ji/sessions when empty.
	Sessions string
	Model    string
	Thinking string
	Yolo     bool
	// Shared is the machine's one service, on its port: the terminal's
	// sessions show as they happen, and it is not the app's to end.
	Shared bool
}

// Server is a service this app started, or the shared one it found; Stop
// ends one of its own.
type Server struct {
	URL    string
	cmd    *exec.Cmd
	shared bool
}

func Start(o Options) (*Server, error) {
	script := o.Script
	if script == "" {
		found, err := findScript(o.Bundled)
		if err != nil {
			return nil, err
		}
		script = found
	}
	node := o.Node
	if node == "" {
		node = "node"
	}

	args := []string{script, "--root", o.Root}
	if o.Shared {
		args = append(args, "--shared")
	} else {
		args = append(args, "--port", "0")
	}
	if o.Sessions != "" {
		args = append(args, "--sessions", o.Sessions)
	}
	if o.Model != "" {
		args = append(args, "--model", o.Model)
	}
	if o.Thinking != "" {
		args = append(args, "--thinking", o.Thinking)
	}
	if o.Yolo {
		args = append(args, "--yolo")
	}
	cmd := exec.Command(node, args...)
	cmd.Dir = filepath.Dir(script)
	cmd.Stderr = os.Stderr
	if o.Shared {
		// Its own process group, so the app's quitting does not end it, and
		// what it says goes where the terminal's start of it writes too
		cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
		if log, err := openLog(); err == nil {
			defer log.Close()
			cmd.Stderr = log
		}
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("starting the agent: %w", err)
	}

	found := make(chan string, 1)
	exited := make(chan error, 1)
	go func() {
		lines := bufio.NewScanner(stdout)
		for lines.Scan() {
			if url, ok := strings.CutPrefix(lines.Text(), "listening on "); ok {
				found <- url
				break
			}
		}
		if o.Shared {
			// It outlives the app: what it prints later is dropped, and it
			// knows to drop it
			_ = stdout.Close()
		} else {
			// Whatever it prints later is not ours to read, but must not block it
			_, _ = io.Copy(io.Discard, stdout)
		}
		// Once its output is read: one that found the shared service
		// running says where and ends
		exited <- cmd.Wait()
	}()

	select {
	case url := <-found:
		return &Server{URL: url, cmd: cmd, shared: o.Shared}, nil
	case err := <-exited:
		select {
		case url := <-found:
			return &Server{URL: url, cmd: cmd, shared: o.Shared}, nil
		default:
		}
		return nil, fmt.Errorf("the agent exited before it listened: %v", err)
	case <-time.After(30 * time.Second):
		_ = cmd.Process.Kill()
		return nil, errors.New("the agent did not listen within 30s")
	}
}

// Stop asks the service to end, and kills it if it has not after a while.
// The shared one is left running: the terminal may use it, and it ends of
// itself once nothing does.
func (s *Server) Stop() {
	if s == nil || s.shared || s.cmd.Process == nil {
		return
	}
	_ = s.cmd.Process.Signal(syscall.SIGTERM)
	done := make(chan struct{})
	go func() {
		_, _ = s.cmd.Process.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		_ = s.cmd.Process.Kill()
	}
}

// openLog is ~/.ji/server.log, for what the shared service says.
func openLog() (*os.File, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(home, ".ji")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	return os.OpenFile(filepath.Join(dir, "server.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
}

// findScript looks for server.ts above the working directory and the
// executable: from apps/desktop in development, or from a build next to the
// repository. Away from it, the app runs the bundle it carries.
func findScript(bundled string) (string, error) {
	var starts []string
	if wd, err := os.Getwd(); err == nil {
		starts = append(starts, wd)
	}
	if exe, err := os.Executable(); err == nil {
		starts = append(starts, filepath.Dir(exe))
	}
	for _, dir := range starts {
		for {
			if candidate := filepath.Join(dir, serverScript); exists(candidate) {
				return candidate, nil
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}
	if exists(bundled) {
		return bundled, nil
	}
	return "", fmt.Errorf(
		"cannot find %s, and the app carries no bundle of it (pnpm desktop:build): pass -agent with its path, or -server with the address of a running one",
		serverScript,
	)
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
