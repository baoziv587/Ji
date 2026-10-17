// Package nodejs finds the Node.js the agent's service runs on, and installs
// one of Ji Agent's own when the computer has none new enough: an official
// build from nodejs.org, checked against the checksum it is pinned to, kept
// in the app's own directory, apart from any other Node.js.
package nodejs

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"time"
)

// MinMajor is the oldest Node.js the service runs on.
const MinMajor = 24

// ErrMissing is what Find says when there is no Node.js new enough.
var ErrMissing = fmt.Errorf("no Node.js %d or later", MinMajor)

// Release is a build of Node.js that Ji Agent installs: where its archives
// are, and the SHA-256 of each platform's, as SHASUMS256.txt lists them.
type Release struct {
	Version string
	Base    string
	Sums    map[string]string
}

// Pinned is the Node.js Ji Agent installs.
var Pinned = Release{
	Version: "v24.21.0",
	Base:    "https://nodejs.org/dist",
	Sums: map[string]string{
		"darwin-arm64": "bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057",
		"darwin-x64":   "1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097",
		"linux-arm64":  "724282c3b43aec998aa9527380465b45d229e021b58035f5f4f63095eabfe5d5",
		"linux-x64":    "6e1db87ef58b8819e5d5402eff1536491b18edd8eb7bee5ef7897876e88dc5ff",
	},
}

// platform is this computer as Node.js names its builds: darwin-arm64,
// linux-x64.
func platform() string {
	arch := runtime.GOARCH
	if arch == "amd64" {
		arch = "x64"
	}
	return runtime.GOOS + "-" + arch
}

// name is the directory the release's archive holds for this platform.
func (r Release) name() string { return "node-" + r.Version + "-" + platform() }

// archive is the file of the release for this platform, and url where
// nodejs.org has it.
func (r Release) archive() string { return r.name() + ".tar.gz" }
func (r Release) url() string     { return r.Base + "/" + r.Version + "/" + r.archive() }

// Runtime is Ji Agent's own Node.js, in Dir once installed.
type Runtime struct {
	Dir     string
	Release Release
}

// Node is the executable of the runtime, which exists once it is installed.
func (rt Runtime) Node() string { return filepath.Join(rt.Dir, rt.Release.name(), "bin", "node") }

// Find returns the Node.js to run the service on: Ji Agent's own once
// installed, else the system's when it is new enough, else ErrMissing.
func Find(own Runtime) (string, error) {
	if node := own.Node(); exists(node) {
		return node, nil
	}
	for _, node := range systemNodes() {
		if major(node) >= MinMajor {
			return node, nil
		}
	}
	return "", ErrMissing
}

// systemNodes are the system's Node.js executables: in PATH, then where
// installers put them, since an app opened from the Finder gets no shell's
// PATH. Each is listed once, so Find asks an old one its version only once.
func systemNodes() []string {
	var nodes []string
	if path, err := exec.LookPath("node"); err == nil {
		nodes = append(nodes, path)
	}

	home, _ := os.UserHomeDir()
	candidates := []string{"/opt/homebrew/bin/node", "/usr/local/bin/node", filepath.Join(home, ".volta/bin/node")}
	if matches, _ := filepath.Glob(filepath.Join(home, ".nvm/versions/node/*/bin/node")); len(matches) > 0 {
		candidates = append(candidates, matches[len(matches)-1])
	}

	for _, c := range candidates {
		if !slices.Contains(nodes, c) && exists(c) {
			nodes = append(nodes, c)
		}
	}
	return nodes
}

// major is the major version node says it is, 0 when it says nothing.
func major(node string) int {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, node, "--version").Output()
	if err != nil {
		return 0
	}

	version := strings.TrimPrefix(strings.TrimSpace(string(out)), "v")
	first, _, _ := strings.Cut(version, ".")
	n, _ := strconv.Atoi(first)
	return n
}

// Install downloads the release for this platform into Dir, saying how much
// of it has come, and returns its executable. Nothing is left in Dir of an
// install that fails or is cancelled.
func (rt Runtime) Install(ctx context.Context, progress func(done, total int64)) (string, error) {
	sum, ok := rt.Release.Sums[platform()]
	if !ok {
		return "", fmt.Errorf("there is no Node.js for Ji Agent to install on %s", platform())
	}

	if err := os.MkdirAll(rt.Dir, 0o755); err != nil {
		return "", err
	}
	work, err := os.MkdirTemp(rt.Dir, ".installing-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(work)

	archive := filepath.Join(work, rt.Release.archive())
	if err := download(ctx, rt.Release.url(), archive, sum, progress); err != nil {
		return "", err
	}
	if err := extract(archive, work); err != nil {
		return "", fmt.Errorf("unpacking Node.js: %w", err)
	}

	final := filepath.Join(rt.Dir, rt.Release.name())
	if err := os.RemoveAll(final); err != nil {
		return "", err
	}
	if err := os.Rename(filepath.Join(work, rt.Release.name()), final); err != nil {
		return "", err
	}

	if !exists(rt.Node()) {
		return "", errors.New("the Node.js downloaded has no bin/node")
	}
	return rt.Node(), nil
}

// download writes what url holds to path, and fails unless its SHA-256 is
// sum.
func download(ctx context.Context, url, path, sum string, progress func(done, total int64)) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("downloading Node.js: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("downloading Node.js: %s answered %s", url, res.Status)
	}

	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()

	hash := sha256.New()
	counted := &counter{total: res.ContentLength, progress: progress}
	if _, err := io.Copy(io.MultiWriter(f, hash, counted), res.Body); err != nil {
		return fmt.Errorf("downloading Node.js: %w", err)
	}
	if got := hex.EncodeToString(hash.Sum(nil)); got != sum {
		return fmt.Errorf("the Node.js downloaded is not the one expected (SHA-256 %s, not %s)", got, sum)
	}
	return f.Close()
}

// counter tells progress how many bytes have passed through it.
type counter struct {
	done, total int64
	progress    func(done, total int64)
}

func (c *counter) Write(b []byte) (int, error) {
	c.done += int64(len(b))
	if c.progress != nil {
		c.progress(c.done, c.total)
	}
	return len(b), nil
}

// extract unpacks the .tar.gz archive into dir: its files, directories and
// links, none of which may reach outside dir.
func extract(archive, dir string) error {
	f, err := os.Open(archive)
	if err != nil {
		return err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}

	r := tar.NewReader(gz)
	for {
		h, err := r.Next()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}

		path := filepath.Join(dir, h.Name)
		if !within(dir, path) {
			return fmt.Errorf("%s is outside the archive", h.Name)
		}

		switch h.Typeflag {
		case tar.TypeDir:
			err = os.MkdirAll(path, 0o755)
		case tar.TypeReg:
			err = writeFile(path, r, h.FileInfo().Mode().Perm())
		case tar.TypeSymlink:
			if !within(dir, filepath.Join(filepath.Dir(path), h.Linkname)) {
				return fmt.Errorf("%s links outside the archive", h.Name)
			}
			if err = os.MkdirAll(filepath.Dir(path), 0o755); err == nil {
				err = os.Symlink(h.Linkname, path)
			}
		}
		if err != nil {
			return err
		}
	}
}

func writeFile(path string, r io.Reader, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
	if err != nil {
		return err
	}
	if _, err := io.Copy(f, r); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

func within(dir, path string) bool {
	rel, err := filepath.Rel(dir, path)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
