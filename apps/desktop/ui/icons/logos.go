package icons

import (
	_ "embed"

	"github.com/egoist/mygo/ui"
)

// The logos of other products, in their own colors, as their makers
// publish them: shown with ui.Image, never tinted or redrawn.

// VSCode is Visual Studio Code's icon, from code.visualstudio.com/brand.
//
//go:embed vscode.svg
var vscodeSVG []byte

var VSCode = ui.MustParseSVG(vscodeSVG)
