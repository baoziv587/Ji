// Package server starts the coding agent's HTTP service, when no address
// of a running one is given: node runs apps/coding-agent/src/server.ts, or the
// bundle of it an installed app carries, on a free port, and the line it
// prints once it listens says where.
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
}

// Server is a service this app started; Stop ends it.
type Server struct {
	URL string
	cmd *exec.Cmd
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

	args := []string{script, "--port", "0", "--root", o.Root}
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
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("starting the agent: %w", err)
	}

	found := make(chan string, 1)
	go func() {
		lines := bufio.NewScanner(stdout)
		for lines.Scan() {
			if url, ok := strings.CutPrefix(lines.Text(), "listening on "); ok {
				found <- url
				break
			}
		}
		// Whatever it prints later is not ours to read, but must not block it
		_, _ = io.Copy(io.Discard, stdout)
	}()
	exited := make(chan error, 1)
	go func() { exited <- cmd.Wait() }()

	select {
	case url := <-found:
		return &Server{URL: url, cmd: cmd}, nil
	case err := <-exited:
		return nil, fmt.Errorf("the agent exited before it listened: %v", err)
	case <-time.After(30 * time.Second):
		_ = cmd.Process.Kill()
		return nil, errors.New("the agent did not listen within 30s")
	}
}

// Stop asks the service to end, and kills it if it has not after a while.
func (s *Server) Stop() {
	if s == nil || s.cmd.Process == nil {
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
	return "", fmt.Errorf("cannot find %s, and the app carries no bundle of it (pnpm desktop:build): pass -agent with its path, or -server with the address of a running one", serverScript)
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
