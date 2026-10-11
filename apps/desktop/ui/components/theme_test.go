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
			l, _ := oklch(v.FieldByName(name).Interface().(ui.Color))
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

func chroma(c ui.Color) float64 {
	_, chroma := oklch(c)
	return chroma
}

// oklch is the OKLCH lightness and chroma of c.
func oklch(c ui.Color) (lightness, chroma float64) {
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
	return lightness, math.Hypot(a, bb)
}
