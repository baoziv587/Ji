package agentui

// Starting the coding agent's HTTP service, when no address of a running one
// is given: node runs apps/coding-agent/src/server.ts on a free port, and the
// line it prints once it listens says where.

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

// ServerOptions is what the service is started with.
type ServerOptions struct {
	// Script is server.ts; found from the working directory or the
	// executable when empty.
	Script string
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

func StartServer(o ServerOptions) (*Server, error) {
	script := o.Script
	if script == "" {
		found, err := findScript()
		if err != nil {
			return nil, err
		}
		script = found
	}
	node, err := findNode()
	if err != nil {
		return nil, err
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
// repository.
func findScript() (string, error) {
	var starts []string
	if wd, err := os.Getwd(); err == nil {
		starts = append(starts, wd)
	}
	if exe, err := os.Executable(); err == nil {
		starts = append(starts, filepath.Dir(exe))
	}
	for _, dir := range starts {
		for {
			candidate := filepath.Join(dir, serverScript)
			if _, err := os.Stat(candidate); err == nil {
				return candidate, nil
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}
	return "", fmt.Errorf("cannot find %s: pass -agent with its path, or -server with the address of a running one", serverScript)
}

// findNode looks in PATH, then where installers put node: an app opened from
// the Finder gets no shell's PATH.
func findNode() (string, error) {
	if path, err := exec.LookPath("node"); err == nil {
		return path, nil
	}
	home, _ := os.UserHomeDir()
	candidates := []string{"/opt/homebrew/bin/node", "/usr/local/bin/node", filepath.Join(home, ".volta/bin/node")}
	if matches, _ := filepath.Glob(filepath.Join(home, ".nvm/versions/node/*/bin/node")); len(matches) > 0 {
		candidates = append(candidates, matches[len(matches)-1])
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c, nil
		}
	}
	return "", errors.New("cannot find node (24 or later): install it, or start the agent yourself and pass -server")
}
