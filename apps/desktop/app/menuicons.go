package app

import (
	"sync"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"

	"desktop/ui/icons"
)

// sessionMenuIcons are the icons of a session's menu, made once: templates,
// in the color of the menu's text.
type sessionMenuIcons struct {
	pin, unpin, newSession, editProject, settle, reopen, remove ui.MenuIcon
}

var menuIcons = sync.OnceValue(func() sessionMenuIcons {
	return sessionMenuIcons{
		pin:         menuIcon(icons.Pin),
		unpin:       menuIcon(icons.PinOff),
		newSession:  menuIcon(icons.SquarePen),
		editProject: menuIcon(icons.FolderPen),
		settle:      menuIcon(icons.Archive),
		reopen:      menuIcon(icons.ArchiveRestore),
		remove:      menuIcon(icons.Trash2),
	}
})

// menuIcon is an icon for menus of svg, none if it cannot be drawn.
func menuIcon(svg *ui.SVG) ui.MenuIcon {
	icon, err := mygo.NewMenuIconSVG(svg, true)
	if err != nil {
		return nil
	}
	return icon
}
