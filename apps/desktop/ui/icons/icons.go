// Package icons holds Lucide's icons, which shadcn/ui draws with: 24 by
// 24, stroked 2 wide, in the color of the text.
package icons

import "github.com/egoist/mygo/ui"

var (
	Archive        = lucide(`<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>`)
	ArchiveRestore = lucide(`<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h2"/><path d="M20 8v11a2 2 0 0 1-2 2h-2"/><path d="m9 15 3-3 3 3"/><path d="M12 12v9"/>`)
	ArrowUp        = lucide(`<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>`)
	Check          = lucide(`<path d="M20 6 9 17l-5-5"/>`)
	ChevronDown    = lucide(`<path d="m6 9 6 6 6-6"/>`)
	ChevronRight   = lucide(`<path d="m9 18 6-6-6-6"/>`)
	FolderOpen     = lucide(`<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>`)
	Info           = lucide(`<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>`)
	Plus           = lucide(`<path d="M5 12h14"/><path d="M12 5v14"/>`)
	Square         = lucide(`<rect width="14" height="14" x="5" y="5" rx="2" fill="currentColor"/>`)
	TriangleAlert  = lucide(`<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>`)
	X              = lucide(`<path d="M18 6 6 18"/><path d="m6 6 12 12"/>`)
)

func lucide(shapes string) *ui.SVG {
	return ui.MustParseSVG([]byte(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` + shapes + `</svg>`))
}
