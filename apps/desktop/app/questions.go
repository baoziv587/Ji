package app

import (
	"fmt"

	"github.com/egoist/mygo/ui"

	"desktop/conversation"
	"desktop/ui/components"
	"desktop/ui/icons"
)

// questions shows what the session waits on, a panel above the input: an
// approval answers with a click, the model's own questions with picks and a
// Send.
func (a *App) questions(c *ui.Context, view *sessionView) {
	t := c.Theme()
	p := components.PaletteOf(t)
	asking := view.t.Asking
	// A call waiting for a yes: one click answers it
	approval := asking.Tool != "" && len(asking.Questions) == 1 && !asking.Questions[0].Multiple &&
		!asking.Questions[0].Other

	ui.Column(c).Padding(0, 24, 12).Children(func() {
		card := conversation.Centered(c, 12, func() {
			for i, q := range asking.Questions {
				ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
					if i == 0 {
						ui.Box(c).Size(8, 8).Radius(4).Background(p.Waiting).Shrink(0)
					}
					ui.Text(c, q.Title).FontWeight(600).Grow(1).Shrink(1)
					if asking.Outside && i == 0 {
						components.Tag(c, "outside the folder", p.Destructive)
					}
				})
				if q.Detail != "" {
					// The lines' bands span the panel, so it pads only above and below
					key := c.Key(fmt.Sprintf("detail:%s:%d", asking.ID, i))
					conversation.Diff(key, asking.Details[i]).
						MaxHeight(220).
						Padding(8, 0).
						Radius(t.Radius).
						Background(p.Muted)
				}
				ui.Row(c.Key(i)).Gap(8).Wrap().Children(func() {
					for _, o := range q.Options {
						style := components.ButtonStyle{
							Variant: components.Outline,
							Size:    components.SizeSmall,
						}
						switch {
						case approval && o.Value == "yes":
							style.Variant = components.Default
						case !approval && view.answer.picked(i, o.Value):
							// A toggle that is on
							style.Variant, style.Icon = components.Secondary, icons.Check
						}
						if approval && o.Value == "no" {
							// Apart from the yeses, so it is not hit for one
							ui.Box(c).Grow(1)
						}
						b := components.Button(c, o.Label, style)
						if o.Hint != "" {
							b.Tooltip(o.Hint)
						}
						if b.Clicked() {
							if approval {
								a.answer(view, [][]string{{o.Value}})
							} else {
								view.answer.toggle(i, o.Value, q.Multiple)
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
					key := c.Key(fmt.Sprint("other", i))
					input := components.TextInput(key, &view.answer.others[i]).
						Placeholder(placeholder).
						Label("Your answer")
					if q.Secret {
						input.Password()
					}
				}
			}
			// An approval's No says it all; the model's questions can be left unanswered
			if !approval {
				ui.Row(c).Gap(8).Justify(ui.End).Children(func() {
					dismiss := components.ButtonStyle{
						Variant: components.Ghost,
						Size:    components.SizeSmall,
					}
					if components.Button(c, "Dismiss", dismiss).
						Tooltip("Answer none of them: the agent asks what you want instead").
						Clicked() {
						a.answer(view, nil)
					}
					send := components.ButtonStyle{Size: components.SizeSmall}
					if components.Button(c, "Send answer", send).Clicked() {
						a.answer(view, view.answer.answers(asking.Questions))
					}
				})
			}
		})
		// The one panel in the waiting color: the agent stops here until it is answered
		card.Padding(16).Radius(t.Radius).Border(1, p.Waiting.Alpha(0.7)).Background(p.Card)
	})
}
