package components

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/egoist/mygo/ui"
)

func TestColorsReadAsShadcnWritesThem(t *testing.T) {
	for value, want := range map[string]ui.Color{
		"#72e3ad":                  ui.RGB(0x72, 0xe3, 0xad),
		"#cae5cc99":                ui.RGBA(0xca, 0xe5, 0xcc, 0.6),
		"rgb(202, 229, 204)":       ui.RGB(202, 229, 204),
		"rgba(202, 229, 204, 0.6)": ui.RGBA(202, 229, 204, 0.6),
		"rgb(100% 0% 0% / 50%)":    ui.RGBA(255, 0, 0, 0.5),
		"hsl(0 0% 0% / 0.09)":      ui.RGBA(0, 0, 0, 0.09),
		"hsl(120deg 100% 25%)":     ui.RGB(0, 128, 0),
		"oklch(1 0 0)":             ui.RGB(255, 255, 255),
		"oklch(100% 0 0 / 0.1)":    ui.RGBA(255, 255, 255, 0.1),
	} {
		got, err := ParseColor(value)
		if err != nil || got != want {
			t.Errorf("%s: %+v, %v; want %+v", value, got, err, want)
		}
	}

	// oklch() as the tests measure it, back to the color it was
	for _, hex := range []string{"#307d33", "#ca3214", "#4164b5", "#f8f5f0", "#121212"} {
		l, c, h := oklch(ui.Hex(hex))
		got, err := ParseColor(fmt.Sprintf("oklch(%.5f %.5f %.3f)", l, c, h))
		want := ui.Hex(hex)
		if err != nil || absDiff(got.R, want.R) > 1 || absDiff(got.G, want.G) > 1 || absDiff(got.B, want.B) > 1 {
			t.Errorf("%s through oklch: %+v, %v", hex, got, err)
		}
	}

	for _, value := range []string{"#12345", "var(--primary)", "rgb(1 2)", "not-a-color"} {
		if _, err := ParseColor(value); err == nil {
			t.Errorf("%s read as a color", value)
		}
	}
}

func absDiff(a, b uint8) uint8 { return max(a, b) - min(a, b) }

// A theme pasted whole from shadcn/ui: all but :root and .dark is passed
// over, and the tokens Ji adds are asked for by name.
func TestSchemeReadsAPastedTheme(t *testing.T) {
	const theme = `@import "tailwindcss";
@custom-variant dark (&:is(.dark *));
:root {
  --background: #fcfcfc;
  --primary: oklch(0.8 0.12 160);
  --chart-1: #72e3ad;
  --font-sans: Outfit, sans-serif;
  --shadow-sm: 0px 1px 3px 0px hsl(0 0% 0% / 0.17), 0px 1px 2px -1px hsl(0 0% 0% / 0.17);
}
.dark { /* nothing yet */ }
@theme inline { --color-background: var(--background); }
@layer base { * { @apply border-border; } body { @apply bg-background; } }`

	_, err := ParseScheme("Pasted", theme)
	if err == nil || !strings.Contains(err.Error(), ":root: missing --foreground") || !strings.Contains(err.Error(), "--code-type") ||
		strings.Contains(err.Error(), "--background,") || strings.Contains(err.Error(), "--primary,") {
		t.Errorf("err %v", err)
	}

	full := func(selector string) string {
		var b strings.Builder
		b.WriteString(selector + " {\n")
		palette := reflect.TypeFor[Palette]()
		for i := range palette.NumField() {
			fmt.Fprintf(&b, "  --%s: #102030;\n", kebab(palette.Field(i).Name))
		}
		return b.String() + "}\n"
	}
	s, err := ParseScheme("Pasted", full(":root")+strings.Replace(full(".dark"), "--sidebar-accent: #102030", "--sidebar-accent: oklch(0.3 0 0 / 60%)", 1))
	if err != nil {
		t.Fatal(err)
	}
	if s.Light.CodeType != ui.Hex("#102030") || s.Dark.SidebarAccent.A != 153 {
		t.Errorf("light %+v, dark %+v", s.Light.CodeType, s.Dark.SidebarAccent)
	}
}

func TestSchemesAreNamedAfterTheirFiles(t *testing.T) {
	var names []string
	for _, s := range Schemes {
		names = append(names, s.Name)
	}
	if got := strings.Join(names, ", "); got != "Forest, Graphite, Lagoon, Slate" {
		t.Errorf("schemes %s", got)
	}
	if got := schemeName("ocean-mist.css"); got != "Ocean Mist" {
		t.Errorf("ocean-mist.css is %q", got)
	}
}

// A stylesheet saved shows at once, or what is wrong with it.
func TestSchemesAreReadAgainAsTheyAreSaved(t *testing.T) {
	if source := SchemesSource(); !strings.HasSuffix(source, filepath.FromSlash("ui/components/schemes")) {
		t.Errorf("schemes watched in %q", source)
	}

	forest, err := schemeFiles.ReadFile("schemes/forest.css")
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	type read struct {
		schemes []*Scheme
		err     error
	}
	reads := make(chan read, 8)
	go WatchSchemes(ctx, dir, func(schemes []*Scheme, err error) { reads <- read{schemes, err} })

	// save writes the file again until a read of it is as wanted: the watch
	// starts on its own, and a save before it may still be read
	save := func(file, css string, wanted func(read) bool) {
		t.Helper()
		var last read
		for range 20 {
			if err := os.WriteFile(filepath.Join(dir, file), []byte(css), 0o644); err != nil {
				t.Fatal(err)
			}
			select {
			case last = <-reads:
				if wanted(last) {
					return
				}
			case <-time.After(250 * time.Millisecond):
			}
		}
		t.Errorf("%s saved, read as %+v", file, last)
	}

	save("forest.css", strings.Replace(string(forest), "--primary: #307d33", "--primary: #ca3214", 1), func(r read) bool {
		return r.err == nil && len(r.schemes) == 1 && r.schemes[0].Light.Primary == ui.Hex("#ca3214")
	})
	save("forest.css", strings.Replace(string(forest), "--foreground: #39221e;", "", 1), func(r read) bool {
		return r.err != nil && strings.Contains(r.err.Error(), "schemes/forest.css: :root: missing --foreground")
	})
	save("forest.css", string(forest), func(r read) bool { return r.err == nil })
	save("ocean-mist.css", string(forest), func(r read) bool {
		return r.err == nil && len(r.schemes) == 2 && r.schemes[0].Name == "Forest" && r.schemes[1].Name == "Ocean Mist"
	})
}
