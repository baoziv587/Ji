package components

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/fsnotify/fsnotify"
)

// SchemesSource is the directory the schemes are built in from, while the
// app runs from its source (go run, mygo dev): "" in a build that is not,
// as mygo build trims the paths, and there is nothing to watch.
func SchemesSource() string {
	_, file, _, ok := runtime.Caller(0)
	dir := filepath.Join(filepath.Dir(file), "schemes")
	if !ok || !filepath.IsAbs(dir) {
		return ""
	}
	if _, err := os.Stat(dir); err != nil {
		return ""
	}
	return dir
}

// WatchSchemes reads the schemes in dir again each time a stylesheet there
// changes, until ctx ends, and hands changed what it read or what is wrong
// with it. The changes of one save, which an editor makes several, are
// read once.
func WatchSchemes(ctx context.Context, dir string, changed func([]*Scheme, error)) error {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}
	defer w.Close()
	if err := w.Add(dir); err != nil {
		return err
	}

	var settled <-chan time.Time
	for {
		select {
		case <-ctx.Done():
			return nil
		case e := <-w.Events:
			if filepath.Ext(e.Name) == ".css" {
				settled = time.After(100 * time.Millisecond)
			}
		case err := <-w.Errors:
			changed(nil, err)
		case <-settled:
			settled = nil
			changed(LoadSchemes(os.DirFS(dir)))
		}
	}
}
