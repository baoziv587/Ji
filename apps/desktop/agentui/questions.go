package agentui

import (
	"fmt"

	"github.com/egoist/mygo/ui"

	"desktop/agentui/conversation"
	"desktop/agentui/icons"
	"desktop/agentui/shadcn"
)

// questions shows what the session waits on, as shadcn/ui's Card above the
// input: an approval answers with a click, the model's own questions with
// picks and a Send.
func (a *App) questions(c *ui.Context, id string, view *sessionView) {
	t := c.Theme()
	p := shadcn.PaletteOf(t)
	asking := view.t.Asking
	// A call waiting for a yes: one click answers it
	approval := asking.Tool != "" && len(asking.Questions) == 1 && !asking.Questions[0].Multiple && !asking.Questions[0].Other

	ui.Column(c).Padding(0, 24, 12).Children(func() {
		card := conversation.Centered(c, 12, func() {
			for i, q := range asking.Questions {
				ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
					ui.Text(c, q.Title).FontWeight(600).Grow(1).Shrink(1)
					if asking.Outside && i == 0 {
						shadcn.Badge(c, "outside the folder", shadcn.Destructive)
					}
				})
				if q.Detail != "" {
					ui.Scroll(c).MaxHeight(220).Padding(8, 12).Radius(t.Radius).Background(p.Muted).Children(func() {
						conversation.Diff(c, q.Detail)
					})
				}
				ui.Row(c.Key(i)).Gap(8).Wrap().Children(func() {
					for _, o := range q.Options {
						style := shadcn.ButtonStyle{Variant: shadcn.Outline, Size: shadcn.SizeSmall}
						switch {
						case approval && o.Value == "yes":
							style.Variant = shadcn.Default
						case !approval && view.picked(i, o.Value):
							// A toggle that is on
							style.Variant, style.Icon = shadcn.Secondary, icons.Check
						}
						b := shadcn.Button(c, o.Label, style)
						if o.Hint != "" {
							b.Tooltip(o.Hint)
						}
						if b.Clicked() {
							if approval {
								a.answer(id, view, [][]string{{o.Value}})
							} else {
								view.toggle(i, o.Value, q.Multiple)
							}
						}
					}
				})
				if q.Other {
					placeholder := "Or type your own answer"
					switch {
					case q.Placeholder != "":
						placeholder = q.Placeholder
					case len(q.Options) == 0:
						placeholder = "Type your answer"
					}
					input := shadcn.TextInput(c.Key(fmt.Sprint("other", i)), &view.others[i]).Placeholder(placeholder).Label("Your answer")
					if q.Secret {
						input.Password()
					}
				}
			}
			// An approval's No says it all; the model's questions can be left unanswered
			if !approval {
				ui.Row(c).Gap(8).Justify(ui.End).Children(func() {
					if shadcn.Button(c, "Dismiss", shadcn.ButtonStyle{Variant: shadcn.Ghost, Size: shadcn.SizeSmall}).
						Tooltip("Answer none of them: the agent asks what you want instead").Clicked() {
						a.answer(id, view, nil)
					}
					if shadcn.Button(c, "Send answer", shadcn.ButtonStyle{Size: shadcn.SizeSmall}).Clicked() {
						a.answer(id, view, view.answers())
					}
				})
			}
		})
		// rounded-xl border bg-card shadow-sm
		card.Padding(16).Radius(14).Border(1, p.Border).Background(p.Card).Shadow(0, 1, 3, 0, ui.RGBA(0, 0, 0, 0.1))
	})
}
