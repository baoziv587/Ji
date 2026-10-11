package components

import (
	"math"
	"reflect"
	"testing"

	"github.com/egoist/mygo/ui"
)

// No color of a scheme is saturated (AGENTS.md): OKLCH chroma at most
// 0.04 for surfaces, 0.06 for the focus ring, 0.10 for anything else.
func TestSchemesAreUnsaturated(t *testing.T) {
	surfaces := map[string]bool{
		"Background": true, "Card": true, "Popover": true,
		"Secondary": true, "Muted": true, "Accent": true,
		"Sidebar": true, "SidebarAccent": true, "SidebarBorder": true,
		"Border": true, "Input": true,
	}

	for _, s := range Schemes {
		for mode, p := range map[string]Palette{"light": s.Light, "dark": s.Dark} {
			v := reflect.ValueOf(p)
			for i := range v.NumField() {
				name := v.Type().Field(i).Name
				limit := 0.10
				switch {
				case surfaces[name]:
					limit = 0.04
				case name == "Ring":
					limit = 0.06
				}

				if c := chroma(v.Field(i).Interface().(ui.Color)); c > limit {
					t.Errorf("%s %s %s: chroma %.3f, at most %.2f", s.Name, mode, name, c, limit)
				}
			}
		}
	}
}

// In the dark, surfaces stand apart by OKLCH lightness, as their hue is
// held low: a card lifts off the ground, a bubble more, and a seam shows
// on both; muted text stays readable yet a step below the text.
func TestDarkSchemesStepApart(t *testing.T) {
	above := []struct {
		name string
		step float64
	}{
		{"Card", 0.05}, {"Secondary", 0.09}, {"Border", 0.13}, {"Input", 0.17},
	}

	for _, s := range Schemes {
		v := reflect.ValueOf(s.Dark)
		lightness := func(name string) float64 {
			l, _, _ := oklch(v.FieldByName(name).Interface().(ui.Color))
			return l
		}

		ground := lightness("Background")
		for _, a := range above {
			if l := lightness(a.name); l-ground < a.step {
				t.Errorf("%s %s: lightness %.3f, at least %.2f above the ground's %.3f", s.Name, a.name, l, a.step, ground)
			}
		}

		muted, text, thinking := lightness("MutedForeground"), lightness("Foreground"), lightness("Thinking")
		if muted < 0.72 || text-muted < 0.12 {
			t.Errorf("%s MutedForeground: lightness %.3f, at least 0.72 and 0.12 below the text's %.3f", s.Name, muted, text)
		}
		if thinking < 0.74 {
			t.Errorf("%s Thinking: lightness %.3f, at least 0.74", s.Name, thinking)
		}
	}
}

// No color of a scheme is violet: one that is not grey keeps out of hues
// 280° to 345°, and thinking takes the scheme's own brand hue.
func TestSchemesHaveNoViolet(t *testing.T) {
	for _, s := range Schemes {
		for mode, p := range map[string]Palette{"light": s.Light, "dark": s.Dark} {
			v := reflect.ValueOf(p)
			for i := range v.NumField() {
				_, chroma, hue := oklch(v.Field(i).Interface().(ui.Color))
				if chroma > 0.02 && hue >= 280 && hue <= 345 {
					t.Errorf("%s %s %s: hue %.0f° is violet", s.Name, mode, v.Type().Field(i).Name, hue)
				}
			}
		}
	}
}

func chroma(c ui.Color) float64 {
	_, chroma, _ := oklch(c)
	return chroma
}

// oklch is the OKLCH lightness, chroma and hue in degrees of c.
func oklch(c ui.Color) (lightness, chroma, hue float64) {
	linear := func(v uint8) float64 {
		x := float64(v) / 255
		if x <= 0.04045 {
			return x / 12.92
		}
		return math.Pow((x+0.055)/1.055, 2.4)
	}
	r, g, b := linear(c.R), linear(c.G), linear(c.B)

	l := math.Cbrt(0.4122214708*r + 0.5363325363*g + 0.0514459929*b)
	m := math.Cbrt(0.2119034982*r + 0.6806995451*g + 0.1073969566*b)
	s := math.Cbrt(0.0883024619*r + 0.2817188376*g + 0.6299787005*b)

	lightness = 0.2104542553*l + 0.7936177850*m - 0.0040720468*s
	a := 1.9779984951*l - 2.4285922050*m + 0.4505937099*s
	bb := 0.0259040371*l + 0.7827717662*m - 0.8086757660*s
	hue = math.Mod(math.Atan2(bb, a)*180/math.Pi+360, 360)
	return lightness, math.Hypot(a, bb), hue
}

// Code reads on every surface it is drawn on: its colors at 4.5:1 at least
// against the wells, the cards and the ground.
func TestCodeColorsRead(t *testing.T) {
	for _, s := range Schemes {
		for mode, p := range map[string]Palette{"light": s.Light, "dark": s.Dark} {
			for name, c := range map[string]ui.Color{"CodeKeyword": p.CodeKeyword, "CodeString": p.CodeString, "CodeNumber": p.CodeNumber, "CodeType": p.CodeType} {
				for ground, g := range map[string]ui.Color{"Muted": p.Muted, "Card": p.Card, "Background": p.Background} {
					if r := contrast(c, g); r < 4.5 {
						t.Errorf("%s %s %s on %s: %.2f:1, at least 4.5:1", s.Name, mode, name, ground, r)
					}
				}
			}
		}
	}
}

// contrast is WCAG's contrast ratio of a and b.
func contrast(a, b ui.Color) float64 {
	luminance := func(c ui.Color) float64 {
		linear := func(v uint8) float64 {
			x := float64(v) / 255
			if x <= 0.04045 {
				return x / 12.92
			}
			return math.Pow((x+0.055)/1.055, 2.4)
		}
		return 0.2126*linear(c.R) + 0.7152*linear(c.G) + 0.0722*linear(c.B)
	}
	hi, lo := luminance(a), luminance(b)
	if hi < lo {
		hi, lo = lo, hi
	}
	return (hi + 0.05) / (lo + 0.05)
}
