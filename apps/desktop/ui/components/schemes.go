package components

import (
	"embed"
	"fmt"
	"io"
	"reflect"
	"strings"
	"unicode"

	"github.com/egoist/mygo/ui"
	"github.com/mazznoer/csscolorparser"
	"github.com/tdewolff/parse/v2"
	"github.com/tdewolff/parse/v2/css"
)

// Each scheme is a stylesheet in schemes/, written as shadcn/ui's themes
// are: the light palette in :root, the dark in .dark, a token to a custom
// property of its name in kebab case (SidebarAccent is --sidebar-accent).
// A theme exported from shadcn/ui's tools can be pasted in whole: what is
// not a token here (charts, fonts, shadows, the @theme block) is passed
// over, and Ji's own tokens, Info to CodeType, are added to it. The scheme
// is named after its file.
//
//go:embed schemes/*.css
var schemeFiles embed.FS

// defaultScheme is the file of the scheme listed first, the rest after it
// by name.
const defaultScheme = "forest.css"

// Schemes are the color schemes to choose from, the default first.
var Schemes = loadSchemes()

func loadSchemes() []*Scheme {
	files, err := schemeFiles.ReadDir("schemes")
	if err != nil {
		panic(err)
	}
	var schemes []*Scheme
	for _, f := range files {
		css, err := schemeFiles.ReadFile("schemes/" + f.Name())
		if err != nil {
			panic(err)
		}
		s, err := ParseScheme(schemeName(f.Name()), string(css))
		if err != nil {
			panic(fmt.Sprintf("schemes/%s: %v", f.Name(), err))
		}
		if f.Name() == defaultScheme {
			schemes = append([]*Scheme{s}, schemes...)
		} else {
			schemes = append(schemes, s)
		}
	}
	return schemes
}

// schemeName is a file's name as the settings show it: "ocean-mist.css"
// is Ocean Mist.
func schemeName(file string) string {
	words := strings.Fields(strings.NewReplacer("-", " ", "_", " ").Replace(strings.TrimSuffix(file, ".css")))
	for i, w := range words {
		words[i] = strings.ToUpper(w[:1]) + w[1:]
	}
	return strings.Join(words, " ")
}

// ParseScheme reads a scheme's stylesheet: every token, light and dark,
// must be there.
func ParseScheme(name, stylesheet string) (*Scheme, error) {
	blocks := map[string]map[string]string{}
	var properties map[string]string
	parser := css.NewParser(parse.NewInputString(stylesheet), false)
	for done := false; !done; {
		grammar, _, data := parser.Next()
		switch grammar {
		case css.ErrorGrammar:
			if err := parser.Err(); err != io.EOF {
				return nil, err
			}
			done = true
		case css.BeginRulesetGrammar:
			var selector strings.Builder
			for _, v := range parser.Values() {
				selector.Write(v.Data)
			}
			properties = nil
			if s := selector.String(); s == ":root" || s == ".dark" {
				properties = map[string]string{}
				blocks[s] = properties
			}
		case css.CustomPropertyGrammar:
			if properties != nil {
				properties[string(data)] = strings.TrimSpace(string(parser.Values()[0].Data))
			}
		}
	}

	s := &Scheme{Name: name}
	for _, b := range []struct {
		selector string
		palette  *Palette
	}{{":root", &s.Light}, {".dark", &s.Dark}} {
		properties, ok := blocks[b.selector]
		if !ok {
			return nil, fmt.Errorf("no %s rule", b.selector)
		}
		if err := readPalette(properties, b.palette); err != nil {
			return nil, fmt.Errorf("%s: %w", b.selector, err)
		}
	}
	return s, nil
}

func readPalette(properties map[string]string, p *Palette) error {
	v := reflect.ValueOf(p).Elem()
	var missing []string
	for i := range v.NumField() {
		property := "--" + kebab(v.Type().Field(i).Name)
		value, ok := properties[property]
		if !ok {
			missing = append(missing, property)
			continue
		}
		c, err := ParseColor(value)
		if err != nil {
			return fmt.Errorf("%s: %w", property, err)
		}
		v.Field(i).Set(reflect.ValueOf(c))
	}
	if len(missing) > 0 {
		return fmt.Errorf("missing %s", strings.Join(missing, ", "))
	}
	return nil
}

func kebab(name string) string {
	var b strings.Builder
	for i, r := range name {
		if unicode.IsUpper(r) {
			if i > 0 {
				b.WriteByte('-')
			}
			r = unicode.ToLower(r)
		}
		b.WriteRune(r)
	}
	return b.String()
}

// ParseColor reads a CSS color as shadcn/ui's themes write them: hex,
// rgb(), hsl(), oklch() or any other CSS color, with an alpha or not. One
// outside sRGB is clipped into it.
func ParseColor(value string) (ui.Color, error) {
	c, err := csscolorparser.Parse(value)
	if err != nil {
		return ui.Color{}, fmt.Errorf("%q: %w", value, err)
	}
	r, g, b, _ := c.Clamp().RGBA255()
	return ui.RGBA(r, g, b, float32(c.A)), nil
}
