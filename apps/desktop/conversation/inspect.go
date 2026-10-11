package conversation

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/egoist/mygo/ui"

	"desktop/syntax"
	"desktop/ui/components"
)

// inspectLine is a line of what the inspector shows of a step: a heading,
// what the call worked on, a line of code or of a diff, a paragraph of
// thinking, a note under the code, or a note that the output is still to
// come.
type inspectLine struct {
	kind inspectKind
	text string
	// A line of code or of a diff, and the subject when it is a command.
	line DiffLine
	// A code line's number, and how many digits the well's numbers take.
	n, digits int
	// Whether it starts or ends its well.
	first, last bool
}

type inspectKind int

const (
	inspectHeading inspectKind = iota
	inspectSubject
	inspectCode
	inspectDiff
	inspectProse
	inspectNote
	inspectPending
)

// Inspect draws step s whole, for the inspector: what a call worked on, its
// input or the diff it makes, and its output, or the thinking in full, in
// Markdown's blocks. A list, which builds only the lines or the blocks in
// view: an output may run to thousands. Selecting across them copies them
// as they are.
func Inspect(c *ui.Context, list *ui.ListState, t *Transcript, s *Item) ui.Element {
	if s.Kind == KindThinking {
		blocks := s.md.blocks
		return ui.List(c, list, len(blocks), func(i int) {
			top := float32(0)
			if i == 0 {
				top = 16
			}
			ui.Column(c).Padding(top, 16, 0).Children(func() {
				markdownBlock(c, &blocks[i])
			})
		}).Selectable()
	}

	lines := inspectLines(t, s.Tool)
	return ui.List(c, list, len(lines), func(i int) {
		inspectRow(c, t, lines[i])
	}).Selectable()
}

// inspectLines are the lines of a call: worked out as it starts and again
// as it ends, not each frame, as its blocks of code are colored in the
// background once each.
func inspectLines(t *Transcript, call *ToolCall) []inspectLine {
	if call.lines != nil && call.linesDone == call.Done {
		return call.lines
	}
	var out []inspectLine
	if call.Target != "" {
		subject := inspectLine{kind: inspectSubject, text: relative(call.Target, t.State.Root)}
		if call.Name == "bash" {
			subject.line = DiffLine{Code: syntax.NewBlock(syntax.Language("bash"), subject.text)}
		}
		out = append(out, subject)
	}
	if call.Edit {
		out = append(out, inspectLine{kind: inspectHeading, text: "Changes"})
		for i, line := range call.Diff {
			out = append(out, inspectLine{kind: inspectDiff, line: line, first: i == 0, last: i == len(call.Diff)-1})
		}
	} else if call.Args != "" {
		out = append(out, inspectLine{kind: inspectHeading, text: "Input"})
		out = append(out, code(indented(call.Args), syntax.Language("json"), 1)...)
	}

	switch {
	case !call.Done:
		out = append(out, inspectLine{kind: inspectHeading, text: "Output"}, inspectLine{kind: inspectPending})
	case call.Stopped:
		out = append(out, inspectLine{kind: inspectHeading, text: "Stopped"}, inspectLine{kind: inspectProse, text: "The reply ended before this call did."})
	case call.Output == "":
		out = append(out, inspectLine{kind: inspectHeading, text: "Output"}, inspectLine{kind: inspectProse, text: "No output."})
	case call.OK && call.Name == "read":
		out = append(append(out, inspectLine{kind: inspectHeading, text: "Output"}), read(call)...)
	case call.OK:
		out = append(append(out, inspectLine{kind: inspectHeading, text: "Output"}), code(call.Output, nil, 1)...)
	default:
		out = append(append(out, inspectLine{kind: inspectHeading, text: "Error"}), code(call.Output, nil, 1)...)
	}
	call.lines, call.linesDone = out, call.Done
	return out
}

// read is what a read gave: the file's lines in its language, numbered
// from where the read started, and under them which lines of how many,
// when that is not all of it.
func read(call *ToolCall) []inspectLine {
	body, note := call.Output, ""
	if i := strings.LastIndex(body, "\n\n[lines "); i >= 0 && strings.HasSuffix(body, "]") {
		body, note = body[:i], body[i+3:len(body)-1]
		note, _, _ = strings.Cut(note, ";")
		note = "Lines " + note + "."
	}
	if body == "(empty file)" {
		return []inspectLine{{kind: inspectProse, text: "The file is empty."}}
	}
	out := code(body, syntax.Language(call.Target), max(call.Offset, 1))
	if note != "" {
		out = append(out, inspectLine{kind: inspectNote, text: note})
	}
	return out
}

// indented is JSON laid out a key a line, and anything else as it is.
func indented(s string) string {
	var b bytes.Buffer
	if json.Indent(&b, []byte(s), "", "  ") != nil {
		return s
	}
	return b.String()
}

// code is text as a well of lines numbered from from, in lang.
func code(text string, lang *syntax.Lang, from int) []inspectLine {
	text = strings.TrimRight(text, "\n")
	block := syntax.NewBlock(lang, text)
	n := strings.Count(text, "\n") + 1
	digits := len(fmt.Sprint(from + n - 1))
	out := make([]inspectLine, n)
	for i := range out {
		out[i] = inspectLine{kind: inspectCode, line: DiffLine{Code: block, At: i}, n: from + i, digits: digits, first: i == 0, last: i == n-1}
	}
	return out
}

func inspectRow(c *ui.Context, t *Transcript, line inspectLine) {
	th := c.Theme()
	p := components.PaletteOf(th)
	xs := components.TextXS(th)
	switch line.kind {
	case inspectHeading:
		ui.Text(c, line.text).FontSize(xs).FontWeight(500).TextColor(p.MutedForeground).Padding(20, 16, 8)
	case inspectSubject:
		var subject ui.Element
		if line.line.Code != nil {
			var spans []ui.Span
			for i, code := range line.line.Code.Lines() {
				if i > 0 {
					spans = append(spans, ui.Span{Text: "\n"})
				}
				spans = appendCode(spans, p, code, [2]int{}, ui.Color{})
			}
			subject = ui.RichText(c, spans...)
		} else {
			subject = ui.Text(c, line.text)
		}
		subject.Font("monospace").TextColor(p.Foreground).LineHeight(1.5).Padding(16, 16, 0)
	case inspectProse:
		ui.Text(c, line.text).TextColor(p.Foreground).LineHeight(1.625).Padding(0, 16, 12)
	case inspectNote:
		ui.Text(c, line.text).FontSize(xs).TextColor(p.MutedForeground).Padding(8, 16, 0)
	case inspectPending:
		ui.Row(c).Gap(8).AlignItems(ui.Center).Padding(0, 16).Children(func() {
			label, color := "Running…", p.Primary
			if t.Asking != nil {
				label, color = "Waiting for your answer…", p.Waiting
			}
			components.Spinner(c, label, 14, color)
			ui.Text(c, label).FontSize(xs).TextColor(p.MutedForeground)
		})
	case inspectCode, inspectDiff:
		// One well: its lines' corners round only at its ends
		top, bottom := float32(0), float32(0)
		if line.first {
			top = 8
		}
		if line.last {
			bottom = 8
		}
		ui.Row(c).Padding(0, 16).Children(func() {
			well := ui.Row(c).Grow(1).MinWidth(0).Background(p.Muted).Radius(top, top, bottom, bottom).Padding(top/2, 0, bottom/2)
			well.Children(func() {
				_, band := diffColors(th, line.line.Kind)
				ui.Row(c).Grow(1).MinWidth(0).Gap(12).Padding(1, 12).Background(band).Children(func() {
					if line.kind == inspectCode {
						lineNumber(c, line.n, line.digits)
					}
					codeLine(c, line.line).LineHeight(1.5).Grow(1).Shrink(1).MinWidth(0)
				})
			})
		})
	}
}
