package conversation

import (
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/egoist/mygo/ui"
	gmtext "github.com/yuin/goldmark/text"

	"desktop/agent"
	"desktop/syntax"
	"desktop/ui/components"
)

func blocksOf(text string, done bool) []mdBlock {
	var m markdown
	m.update(text, done)
	return m.blocks
}

// The reply streams in as Markdown: a fence being written shows as
// neither text nor code, and a block of code is colored a line once it
// ends, its colors carried on as it is parsed again.
func TestReplyStreamsAsMarkdown(t *testing.T) {
	var tr Transcript
	for _, delta := range []string{"Here:\n``", "`go\nfunc main() {\n\treturn", "\n}\n``"} {
		tr.Apply(agent.Event{Type: "text", Delta: delta})
	}
	blocks := tr.Items[0].md.blocks
	if len(blocks) != 2 || blocks[0].runs[0].text != "Here:" || blocks[1].kind != mdCode {
		t.Fatalf("blocks %+v", blocks)
	}
	code := blocks[1].code
	if code.lang != "go" || code.text != "func main() {\n\treturn\n}\n" {
		t.Fatalf("code %+v", code)
	}
	if lines := code.block.Lines(); len(lines) != 4 || lines[1][1] != (syntax.Span{Text: "return", Kind: syntax.Keyword}) {
		t.Errorf("lines %+v", lines)
	}

	tr.Apply(agent.Event{Type: "text", Delta: "`\nDone."})
	blocks = tr.Items[0].md.blocks
	if len(blocks) != 3 || blocks[1].code != code || code.text != "func main() {\n\treturn\n}" || blocks[2].runs[0].text != "Done." {
		t.Fatalf("blocks once closed %+v, code %q", blocks, code.text)
	}
	if lines := code.block.Lines(); len(lines) != 3 || lines[2][0] != (syntax.Span{Text: "}", Kind: syntax.Punctuation}) {
		t.Errorf("lines once closed %+v", lines)
	}
}

// A fence of fewer backticks, or with a language, does not close a block.
func TestFenceClosesOnlyItsBlock(t *testing.T) {
	blocks := blocksOf("````md\n```go\nx\n```\n````\n", false)
	if len(blocks) != 1 || blocks[0].code.lang != "md" || blocks[0].code.text != "```go\nx\n```" {
		t.Errorf("blocks %+v", blocks)
	}
}

// What comes before a blank line and a line at the margin is parsed for
// good; a blank line in a fence or before an item's next paragraph is no
// cut.
func TestMarkdownIsCutWhereNoBlockRunsOn(t *testing.T) {
	var m markdown
	text := "```\nx\n\ny\n```\n\n- a\n\n  more\n\nlast\n"
	m.update(text, false)
	if m.fixed != 3 || len(m.blocks) != 4 || m.stable != strings.Index(text, "last") {
		t.Fatalf("fixed %d of %+v, stable %d", m.fixed, m.blocks, m.stable)
	}
	if m.blocks[0].code.text != "x\n\ny" {
		t.Errorf("code %q", m.blocks[0].code.text)
	}
	more := m.blocks[2]
	if more.runs[0].text != "more" || len(more.in) != 1 || more.in[0].first || more.gap != 12 {
		t.Errorf("the item's next paragraph %+v", more)
	}

	fixed := &m.blocks[0]
	m.update(text+"words", false)
	if &m.blocks[0] != fixed || m.blocks[3].runs[0].text != "last\nwords" {
		t.Errorf("after more, %+v", m.blocks)
	}
}

// A line that may still turn out something else is held back until it
// ends, or until no more comes.
func TestALineIsHeldWhileItMayTurnOutABlock(t *testing.T) {
	if blocks := blocksOf("Title\n---", false); len(blocks) != 1 || blocks[0].kind != mdParagraph {
		t.Errorf("while written %+v", blocks)
	}
	if blocks := blocksOf("Title\n---", true); len(blocks) != 1 || blocks[0].kind != mdHeading || blocks[0].level != 2 {
		t.Errorf("done %+v", blocks)
	}
}

// Lists and quotes come out flat, each block with the items and quotes it
// is in: an item's marker on its first block, its list's markers' width,
// and the room above it.
func TestListsAndQuotesComeOutFlat(t *testing.T) {
	blocks := blocksOf("Steps:\n- a\n- b\n  - c\n\n> q\n> - [x] done\n\n9. x\n10. y\n", true)
	type got struct {
		text   string
		marker string
		task   mdTask
		quotes int
		gap    float32
	}
	var out []got
	for _, b := range blocks {
		g := got{text: b.runs[0].text, gap: b.gap}
		for _, box := range b.in {
			if box.quote {
				g.quotes++
			} else if box.first {
				g.marker, g.task = box.marker, box.task
			}
		}
		out = append(out, g)
	}
	want := []got{
		{"Steps:", "", 0, 0, 0},
		{"a", "•", 0, 0, 8},
		{"b", "•", 0, 0, 4},
		{"c", "◦", 0, 0, 4},
		{"q", "", 0, 1, 12},
		{"done", "•", taskDone, 1, 8},
		{"x", "9.", 0, 0, 12},
		{"y", "10.", 0, 0, 4},
	}
	if !reflect.DeepEqual(out, want) {
		t.Errorf("blocks\n got %+v\nwant %+v", out, want)
	}
	if w := blocks[6].in[0].width; w != 2*7+12 {
		t.Errorf("width of 10. is %v", w)
	}
}

func TestInlineRunsKeepTheirStyles(t *testing.T) {
	blocks := blocksOf("**b** *i* `c` [l](http://x) ~~s~~ a\\*b &amp; <https://y>\nnext", true)
	want := []mdRun{
		{"b", styleStrong, ""}, {" ", 0, ""}, {"i", styleEmphasis, ""}, {" ", 0, ""}, {"c", styleCode, ""}, {" ", 0, ""},
		{"l", styleLink, "http://x"}, {" ", 0, ""}, {"s", styleStrike, ""}, {" a*b & ", 0, ""},
		{"https://y", styleLink, "https://y"}, {"\nnext", 0, ""},
	}
	if len(blocks) != 1 || !reflect.DeepEqual(blocks[0].runs, want) {
		t.Errorf("runs\n got %+v\nwant %+v", blocks[0].runs, want)
	}
}

// A long paragraph is cut at a line break past every pieceSize bytes, and
// a piece once cut stays the same as the paragraph grows.
func TestALongParagraphIsCutIntoPieces(t *testing.T) {
	line := strings.Repeat("word ", 59) + "word\n"
	text := strings.Repeat(line, 20)
	blocks := blocksOf(text, false)
	if len(blocks) != 3 || blocks[1].gap != 0 || strings.HasSuffix(blocks[0].runs[0].text, "\n") {
		t.Fatalf("%d blocks, gap %v", len(blocks), blocks[1].gap)
	}
	var joined []string
	for _, b := range blocks {
		joined = append(joined, b.runs[0].text)
	}
	if strings.Join(joined, "\n") != strings.TrimSuffix(text, "\n") {
		t.Errorf("the pieces do not make the paragraph")
	}
	more := blocksOf(text+strings.Repeat(line, 10), false)
	if more[0].runs[0].text != blocks[0].runs[0].text || more[1].runs[0].text != blocks[1].runs[0].text {
		t.Errorf("the pieces cut moved")
	}
}

// As a block of code streams in, only its chunk being written is made
// again; all of them are in another palette.
func TestACodeBlockMakesOnlyItsLastChunkAgain(t *testing.T) {
	var tr Transcript
	text := "```\n" + strings.Repeat("x := 1\n", chunk+4)
	tr.Apply(agent.Event{Type: "text", Delta: text})
	code := tr.Items[0].md.blocks[0].code
	p := &components.Palette{}
	first := code.chunks(p)
	head := &first[0][0]
	if len(first) != 2 {
		t.Fatalf("%d chunks", len(first))
	}

	tr.Apply(agent.Event{Type: "text", Delta: "y"})
	more := code.chunks(p)
	if len(more) != 2 || &more[0][0] != head || more[1][len(more[1])-1].Text != "y" {
		t.Errorf("chunks %+v", more)
	}
	var joined []string
	for _, spans := range more {
		var s strings.Builder
		for _, span := range spans {
			s.WriteString(span.Text)
		}
		joined = append(joined, s.String())
	}
	if strings.Join(joined, "\n") != strings.TrimSuffix(code.text, "\n") {
		t.Errorf("the chunks make %q, not %q", strings.Join(joined, "\n"), code.text)
	}
	if again := code.chunks(&components.Palette{}); &again[0][0] == head {
		t.Errorf("kept in another palette")
	}
}

// A table's head and rows, each cell in its runs.
func TestTablesKeepTheirCells(t *testing.T) {
	blocks := blocksOf("| a | **b** |\n|---|--:|\n| 1 | 2 |\n", true)
	if len(blocks) != 1 || blocks[0].kind != mdTable {
		t.Fatalf("blocks %+v", blocks)
	}
	rows := blocks[0].table.rows
	if len(rows) != 2 || rows[0][1][0] != (mdRun{"b", styleStrong, ""}) || rows[1][1][0].text != "2" {
		t.Errorf("rows %+v", rows)
	}
}

// The inspector works out a call's lines as it starts and again as it
// ends, not each frame: each frame made its blocks of code anew, to be
// lexed again, which drew another frame.
func TestACallsLinesAreWorkedOutOnceWhileItRuns(t *testing.T) {
	var tr Transcript
	tr.Apply(agent.Event{Type: "tool_start", ID: "1", Name: "bash", Args: `{"command":"ls"}`})
	call := tr.Steps[0].Tool
	first := inspectLines(&tr, call)
	if again := inspectLines(&tr, call); &again[0] != &first[0] {
		t.Errorf("worked out again while it runs")
	}
	tr.Apply(agent.Event{Type: "tool_end", ID: "1", Name: "bash", OK: true, Output: "a"})
	if done := inspectLines(&tr, call); &done[0] == &first[0] || done[len(done)-1].kind != inspectCode {
		t.Errorf("not worked out again as it ended: %+v", done)
	}
}

// Only the call inspected last keeps its lines; one inspected again has
// them worked out again.
func TestOnlyTheCallInspectedKeepsItsLines(t *testing.T) {
	var tr Transcript
	for _, id := range []string{"1", "2"} {
		tr.Apply(agent.Event{Type: "tool_start", ID: id, Name: "bash", Args: `{"command":"ls"}`})
		tr.Apply(agent.Event{Type: "tool_end", ID: id, Name: "bash", OK: true, Output: "out " + id})
	}
	one, two := tr.Steps[0].Tool, tr.Steps[1].Tool
	want := inspectLines(&tr, one)
	inspectLines(&tr, two)
	if one.lines != nil || two.lines == nil {
		t.Fatalf("lines kept: %v and %v", one.lines != nil, two.lines != nil)
	}
	again := inspectLines(&tr, one)
	if two.lines != nil || len(again) != len(want) || again[len(again)-1].line.Code.Lines()[0][0].Text != "out 1" {
		t.Errorf("inspected again %+v", again)
	}
}

// A delta to a long paragraph, its lines not cut by a blank one: each line
// added to the run before it copied the whole run again.
func BenchmarkADeltaToALongParagraph(b *testing.B) {
	text := strings.Repeat("some words in a long line of prose here\n", 2000)
	var m markdown
	m.update(text, false)
	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		m.update(text+"more", false)
	}
}

// Streamed a byte at a time, cut where it can be and a fence at the margin
// written to its code as it comes, a reply shows at every step what
// goldmark makes of all of it at once.
func TestAStreamedReplyShowsAsItsWholeParse(t *testing.T) {
	docs := []string{
		"Intro text\n```go\nfunc main() {\n\tx := 1\n\n}\n```\nAfter text\n\n- item\n```\nplain\n```\n1. one\n2. two\n\n> quote\n```py\nprint(1)\n```\n",
		"# Head\n```\ncode\n\n\nmore\n````\n```\n\n~~~ sh extra\nls\n~~~\n- a\n  ```\n  in the item\n  ```\n",
		"<div>\n```\nnot a fence\n```\n</div>\n\nText\n```js\nlet a\n",
	}
	for _, doc := range docs {
		var m markdown
		for i := range len(doc) + 1 {
			m.update(doc[:i], false)
			if got, want := shapes(m.blocks), shapes(wholeParse(doc[:i], false)); !reflect.DeepEqual(got, want) {
				t.Fatalf("after %q:\n got %+v\nwant %+v", doc[:i], got, want)
			}
		}
		m.update(doc, true)
		if got, want := shapes(m.blocks), shapes(wholeParse(doc, true)); !reflect.DeepEqual(got, want) {
			t.Fatalf("done %q:\n got %+v\nwant %+v", doc, got, want)
		}
	}
}

// wholeParse is the blocks of text parsed at once, without cuts. goldmark
// ends the line being written in an open fence with a line break, which
// the fence written to as it comes leaves out, so that the line is not
// colored before it ends.
func wholeParse(text string, done bool) []mdBlock {
	if !done {
		start := strings.LastIndexByte(text, '\n') + 1
		if held.MatchString(text[start:]) {
			text = text[:start]
		}
	}
	f := flattener{src: []byte(text), whole: done, pending: -1}
	f.children(parser.Parse(gmtext.NewReader(f.src)))
	if n := len(f.out); !done && n > 0 && f.out[n-1].code != nil && !strings.HasSuffix(text, "\n") {
		code := f.out[n-1].code
		code.text = strings.TrimSuffix(code.text, "\n")
	}
	return f.out
}

type shape struct {
	kind       mdKind
	level      int
	runs       []mdRun
	lang, code string
	in         []mdBox
	gap        float32
}

func shapes(blocks []mdBlock) []shape {
	var out []shape
	for _, b := range blocks {
		s := shape{kind: b.kind, level: b.level, runs: b.runs, in: b.in, gap: b.gap}
		if b.code != nil {
			s.lang, s.code = b.code.lang, b.code.text
		}
		out = append(out, s)
	}
	return out
}

// A fence of 2000 lines, written 20 bytes a delta, its lines shown as each
// delta comes.
func BenchmarkStreamingALongFence(b *testing.B) {
	var doc strings.Builder
	doc.WriteString("Here it is:\n```txt\n")
	for i := range 2000 {
		fmt.Fprintf(&doc, "line %4d of the file, padded to forty..\n", i)
	}
	doc.WriteString("```\n")
	text := doc.String()

	b.ReportAllocs()
	for b.Loop() {
		var m markdown
		for end := 20; end < len(text)+20; end += 20 {
			m.update(text[:min(end, len(text))], false)
			if last := m.blocks[len(m.blocks)-1]; last.code != nil {
				last.code.chunks(components.PaletteOf(&ui.Theme{}))
			}
		}
	}
}

func TestCodeKind(t *testing.T) {
	for s, want := range map[string]components.CodeKind{
		"Emulation.setFocusEmulationEnabled":    components.CodeCall,
		"document.hasFocus()=false, el.focus()": components.CodeCall,
		"child.kill('SIGKILL')":                 components.CodeCall,
		"Browser.close":                         components.CodeCall,
		"$TMPDIR/org.chromium.Chromium.*":       components.CodePath,
		"/tmp/k8s-*.png":                        components.CodePath,
		"Default/":                              components.CodePath,
		"Singleton*":                            components.CodePath,
		"cdp.js":                                components.CodePath,
		"PRODUCT.md":                            components.CodePath,
		"~/.zshrc":                              components.CodePath,
		"SIGKILL":                               components.CodeWord,
		"TMPDIR":                                components.CodeWord,
		"rm -rf":                                components.CodeWord,
		"0.5":                                   components.CodeWord,
		"v1.2.3":                                components.CodeWord,
	} {
		if got := codeKind(s); got != want {
			t.Errorf("codeKind(%q) = %d, want %d", s, got, want)
		}
	}
}
