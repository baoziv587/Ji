package fileicons

import (
	"io/fs"
	"testing"

	"github.com/egoist/mygo/ui"
)

func TestEveryIconParses(t *testing.T) {
	names, err := fs.Glob(files, "icons/*.svg")
	if err != nil || len(names) == 0 {
		t.Fatal(names, err)
	}
	for _, name := range names {
		data, _ := files.ReadFile(name)
		if _, err := ui.ParseSVG(data); err != nil {
			t.Errorf("%s: %v", name, err)
		}
	}
	for id, def := range loaded().IconDefinitions {
		if def.IconPath[:len("./icons/files/")] != "./icons/files/" {
			continue
		}
		if parse(loaded(), id) == nil {
			t.Errorf("%s has no icon", id)
		}
	}
}

func TestFilesTakeTheThemesIcons(t *testing.T) {
	for name, want := range map[string]string{
		"main.go":            "go",
		"apps/web/App.tsx":   "react-ts",
		"src/index.d.ts":     "ts-types",
		"login.test.ts":      "ts-test",
		"README.md":          "readme",
		"docs/notes.md":      "markdown",
		"Dockerfile":         "docker",
		"go.sum":             "go-mod",
		"index.php":          "php",
		"tsconfig.jsonc":     "brackets-yellow",
		"Makefile":           "gear",
		"src\\lib\\util.hpp": "cplus",
		"notes":              "document",
		"archive.unknown":    "document",
	} {
		if got := ID(name); got != want {
			t.Errorf("%s: %s, want %s", name, got, want)
		}
		if For(name) == nil {
			t.Errorf("%s has no icon", name)
		}
	}
}
