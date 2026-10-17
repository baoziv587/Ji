package nodejs

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// entry is a file of a test archive: a link when link is set.
type entry struct{ name, body, link string }

func archive(t *testing.T, entries ...entry) []byte {
	t.Helper()
	var b bytes.Buffer
	gz := gzip.NewWriter(&b)
	w := tar.NewWriter(gz)
	for _, e := range entries {
		h := &tar.Header{Name: e.name, Mode: 0o755, Size: int64(len(e.body)), Typeflag: tar.TypeReg}
		if e.link != "" {
			h.Typeflag, h.Linkname, h.Size = tar.TypeSymlink, e.link, 0
		}
		if err := w.WriteHeader(h); err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(e.body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// serve serves body as the release's archive for this platform, which
// checks out against sum, the archive's own when empty.
func serve(t *testing.T, body []byte, sum string) Runtime {
	t.Helper()
	if sum == "" {
		hash := sha256.Sum256(body)
		sum = hex.EncodeToString(hash[:])
	}
	release := Release{Version: "v24.0.0", Sums: map[string]string{platform(): sum}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v24.0.0/"+release.name()+".tar.gz" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write(body)
	}))
	t.Cleanup(server.Close)
	release.Base = server.URL
	return Runtime{Dir: t.TempDir(), Release: release}
}

func TestInstallUnpacksTheRelease(t *testing.T) {
	top := "node-v24.0.0-" + platform()
	rt := serve(t, archive(t,
		entry{name: top + "/bin/node", body: "#!/bin/sh\necho v24.0.0\n"},
		entry{name: top + "/bin/npm", link: "../lib/npm-cli.js"},
		entry{name: top + "/lib/npm-cli.js", body: "npm"},
	), "")

	var done, total int64
	node, err := rt.Install(context.Background(), func(d, t int64) { done, total = d, t })
	if err != nil {
		t.Fatal(err)
	}
	if node != rt.Node() || done != total || total == 0 {
		t.Errorf("installed %s, %d of %d bytes", node, done, total)
	}
	if got, _ := Find(rt); got != node {
		t.Errorf("Find returns %q, not the runtime installed", got)
	}
	if link, _ := os.Readlink(filepath.Join(rt.Dir, top, "bin", "npm")); link != "../lib/npm-cli.js" {
		t.Errorf("bin/npm links to %q", link)
	}
	if left, _ := filepath.Glob(filepath.Join(rt.Dir, ".installing-*")); len(left) > 0 {
		t.Errorf("left %v behind", left)
	}
}

func TestInstallRefusesWhatIsNotTheRelease(t *testing.T) {
	top := "node-v24.0.0-" + platform()
	rt := serve(t, archive(t, entry{name: top + "/bin/node", body: "tampered"}), strings.Repeat("0", 64))
	if _, err := rt.Install(context.Background(), nil); err == nil || !strings.Contains(err.Error(), "SHA-256") {
		t.Errorf("installed an archive of another checksum: %v", err)
	}
	if entries, _ := os.ReadDir(rt.Dir); len(entries) > 0 {
		t.Errorf("left %v behind", entries)
	}
}

func TestInstallKeepsToItsDirectory(t *testing.T) {
	for name, e := range map[string]entry{
		"a file": {name: "../outside", body: "x"},
		"a link": {name: "node/bin/node", link: "../../../outside"},
	} {
		t.Run(name, func(t *testing.T) {
			rt := serve(t, archive(t, e), "")
			if _, err := rt.Install(context.Background(), nil); err == nil || !strings.Contains(err.Error(), "outside") {
				t.Errorf("unpacked %s outside the runtime: %v", name, err)
			}
		})
	}
}

func TestInstallCancelled(t *testing.T) {
	rt := serve(t, archive(t), "")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := rt.Install(ctx, nil); err == nil {
		t.Error("a cancelled install went on")
	}
}

func TestMajorReadsTheVersion(t *testing.T) {
	node := filepath.Join(t.TempDir(), "node")
	if err := os.WriteFile(node, []byte("#!/bin/sh\necho v24.21.0\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if got := major(node); got != 24 {
		t.Errorf("major = %d, want 24", got)
	}
	if got := major(filepath.Join(t.TempDir(), "missing")); got != 0 {
		t.Errorf("major of no node = %d, want 0", got)
	}
}

// TestInstallPinned installs the pinned release from nodejs.org and runs it:
// JI_AGENT_DOWNLOAD=1.
func TestInstallPinned(t *testing.T) {
	if os.Getenv("JI_AGENT_DOWNLOAD") != "1" {
		t.Skip("JI_AGENT_DOWNLOAD is not set")
	}
	rt := Runtime{Dir: t.TempDir(), Release: Pinned}
	node, err := rt.Install(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := major(node); got < MinMajor {
		t.Errorf("%s is Node.js %d", node, got)
	}
}
