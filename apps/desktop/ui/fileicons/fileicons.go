// Package fileicons holds the file icons of Miguel Solorio's Symbols
// (github.com/miguelsolorio/vscode-symbols, MIT, see LICENSE), in their
// own colors, with its theme's rules for which file takes which.
//
// icons/ and theme.json are the project's src/icons/files and
// src/symbol-icon-theme.json, unchanged, as of commit a405d32 (v0.0.25):
// copy them again to update.
package fileicons

import (
	"embed"
	"encoding/json"
	"path"
	"strings"
	"sync"

	"github.com/egoist/mygo/ui"
)

var (
	//go:embed icons/*.svg
	files embed.FS
	//go:embed theme.json
	themeJSON []byte
)

type theme struct {
	IconDefinitions map[string]struct {
		IconPath string `json:"iconPath"`
	} `json:"iconDefinitions"`
	File           string            `json:"file"`
	FileExtensions map[string]string `json:"fileExtensions"`
	FileNames      map[string]string `json:"fileNames"`
	LanguageIDs    map[string]string `json:"languageIds"`
}

// loaded is the theme read once, its names and extensions in lower case
// as VS Code matches them, and the icons parsed so far.
var loaded = sync.OnceValue(func() *theme {
	var t theme
	if err := json.Unmarshal(themeJSON, &t); err != nil {
		panic("fileicons: " + err.Error())
	}
	t.FileNames = lower(t.FileNames)
	t.FileExtensions = lower(t.FileExtensions)
	return &t
})

var (
	mu     sync.Mutex
	parsed = map[string]*ui.SVG{}
)

func lower(m map[string]string) map[string]string {
	out := make(map[string]string, len(m))
	for k, v := range m {
		out[strings.ToLower(k)] = v
	}
	return out
}

// For is the icon of the file at name, a path or a base name, to show
// with ui.Image: that of its name, else of its longest extension, else of
// its language, else a plain document.
func For(name string) *ui.SVG {
	t := loaded()
	id := ID(name)
	mu.Lock()
	defer mu.Unlock()
	if svg, ok := parsed[id]; ok {
		return svg
	}
	svg := parse(t, id)
	if svg == nil {
		svg = parse(t, t.File)
	}
	parsed[id] = svg
	return svg
}

func parse(t *theme, id string) *ui.SVG {
	data, err := files.ReadFile("icons/" + path.Base(t.IconDefinitions[id].IconPath))
	if err != nil {
		return nil
	}
	svg, err := ui.ParseSVG(data)
	if err != nil {
		return nil
	}
	return svg
}

// ID is the theme's name for the icon of the file at name.
func ID(name string) string {
	t := loaded()
	base := strings.ToLower(path.Base(strings.ReplaceAll(name, `\`, "/")))
	if id, ok := t.FileNames[base]; ok {
		return id
	}
	// "a.service.ts" is a service.ts before it is a ts
	for i := range len(base) {
		if base[i] != '.' {
			continue
		}
		if id, ok := t.FileExtensions[base[i+1:]]; ok {
			return id
		}
	}
	if id, ok := t.LanguageIDs[languageOf(base)]; ok {
		return id
	}
	return t.File
}
