package conversation

// The reply's text and the thinking as Markdown, parsed by goldmark as it
// streams in. goldmark parses a document whole, so the text is cut where
// no block runs on across the cut: at a blank line, outside a fence,
// before a line at the margin. What comes before the last cut is parsed
// once, for good; only what comes after it, the blocks still being
// written, is parsed again as the text grows. A line that may still turn
// out a fence, a heading, an item, a rule or a table's is held back until
// it ends, as the terminal holds it.
//
// The blocks come out flat, each with the list items and quotes it is in,
// so that the inspector's list builds only those in view.

import (
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/egoist/mygo/ui"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	extast "github.com/yuin/goldmark/extension/ast"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"

	"desktop/syntax"
	"desktop/ui/components"
)

type markdown struct {
	blocks []mdBlock
	// How many of the blocks are for good, and how much of the text they
	// are.
	fixed, stable int
	// How far the text was scanned for cuts, the fence open there, and
	// whether the line before was blank.
	scanned int
	fence   string
	blank   bool
	// The code blocks among those still being written, which the next
	// parse takes again in order so that their colors carry on.
	codes []*fenced
}

type mdKind uint8

const (
	mdParagraph mdKind = iota
	mdHeading
	mdCode
	mdRule
	mdTable
)

type mdBlock struct {
	kind  mdKind
	level int
	runs  []mdRun
	code  *fenced
	table *mdRows
	// The list items and quotes it is in, the outermost first.
	in []mdBox
	// The room above it.
	gap float32
}

// mdBox is a list item or a quote a block is in. On the first block in
// it, a list item shows its marker and a quote's bar starts.
type mdBox struct {
	quote, first bool
	marker       string
	// A task's box: none, open or done.
	task mdTask
	// How wide the markers of its list are.
	width float32
}

type mdTask uint8

const (
	noTask mdTask = iota
	taskOpen
	taskDone
)

type mdRun struct {
	text  string
	style mdStyle
	url   string
}

type mdStyle uint8

const (
	styleStrong mdStyle = 1 << iota
	styleEmphasis
	styleCode
	styleStrike
	styleLink
)

type mdRows struct {
	align []extast.Alignment
	// The head first.
	rows [][][]mdRun
}

// fenced is a block of code: the language its fence names, its text, and
// its lines in color.
type fenced struct {
	lang, text string
	block      *syntax.Block
	// When its Copy was clicked, and its lines in spans as last drawn and
	// what they were of; the window's own.
	copied  time.Time
	spans   [][]ui.Span
	spansOf struct {
		lines   *syntax.Line
		n       int
		palette *components.Palette
	}
}

var parser = goldmark.New(goldmark.WithExtensions(extension.GFM)).Parser()

// held is a line that may still turn out a fence, a table's, a rule, a
// heading, an item or a quote while it is written: the terminal's HOLD.
var held = regexp.MustCompile("(?i)^ {0,3}(?:`{0,3}$|```|~{0,3}$|~~~|\\|)|^[\\s>#*+\\-_\\d.)\\[\\]x]*$")

// fenceOpen and fenceClose open and close a fenced block.
var (
	fenceOpen  = regexp.MustCompile("^ {0,3}(`{3,}|~{3,})(.*)")
	fenceClose = regexp.MustCompile("^ {0,3}(`{3,}|~{3,})[ \t]*$")
)

// update takes the text so far; done once no more of it comes, when no
// line is held back.
func (m *markdown) update(text string, done bool) {
	m.scan(text)

	tail := text[m.stable:]
	if !done {
		start := strings.LastIndexByte(tail, '\n') + 1
		if held.MatchString(tail[start:]) {
			tail = tail[:start]
		}
	}
	m.blocks = m.blocks[:m.fixed]
	m.codes = m.parse(tail, done)
}

// last is the text of the last block, without its marks.
func (m *markdown) last() string {
	if len(m.blocks) == 0 {
		return ""
	}
	b := m.blocks[len(m.blocks)-1]
	if b.code != nil {
		return b.code.text
	}
	var s strings.Builder
	for _, r := range b.runs {
		s.WriteString(r.text)
	}
	return s.String()
}

// scan looks through the lines ended since it last did for the cuts.
func (m *markdown) scan(text string) {
	for {
		n := strings.IndexByte(text[m.scanned:], '\n')
		if n < 0 {
			return
		}
		start := m.scanned
		line := text[start : start+n]
		m.scanned = start + n + 1

		if m.fence != "" {
			if f := fenceClose.FindStringSubmatch(line); f != nil && f[1][0] == m.fence[0] && len(f[1]) >= len(m.fence) {
				m.fence = ""
			}
			continue
		}

		if m.blank && strings.TrimSpace(line) != "" && line[0] != ' ' && line[0] != '\t' {
			m.blocks = m.blocks[:m.fixed]
			m.codes = m.parse(text[m.stable:start], true)
			m.fixed, m.stable = len(m.blocks), start
		}
		m.blank = strings.TrimSpace(line) == ""
		if f := fenceOpen.FindStringSubmatch(line); f != nil && (f[1][0] == '~' || !strings.Contains(f[2], "`")) {
			m.fence = f[1]
		}
	}
}

// parse puts the blocks of src after the blocks, taking the code blocks
// kept in order; whole when nothing more of src comes. It gives back the
// code blocks it did not take, or, for blocks still being written, those
// it took.
func (m *markdown) parse(src string, whole bool) []*fenced {
	f := flattener{src: []byte(src), whole: whole, cut: m.stable > 0, codes: m.codes, out: m.blocks, pending: -1}
	f.children(parser.Parse(text.NewReader(f.src)))
	m.blocks = f.out
	if whole {
		return f.codes
	}
	return f.took
}

type flattener struct {
	src []byte
	// Whether nothing more of src comes, and whether it comes after a cut,
	// a blank line.
	whole, cut bool
	out        []mdBlock
	in         []mdBox
	// The code blocks to take in order, and those taken.
	codes, took []*fenced
	// The room above the next block, -1 for the usual; whether it is in a
	// tight list; and the task box its paragraph starts with.
	pending float32
	tight   bool
	task    mdTask
}

func (f *flattener) children(n ast.Node) {
	for c := n.FirstChild(); c != nil; c = c.NextSibling() {
		f.block(c)
	}
}

func (f *flattener) block(n ast.Node) {
	switch n := n.(type) {
	case *ast.Paragraph, *ast.TextBlock:
		for i, piece := range pieces(f.inline(n)) {
			if i > 0 {
				f.pending = 0
			}
			f.add(mdBlock{kind: mdParagraph, runs: piece})
		}
	case *ast.Heading:
		f.add(mdBlock{kind: mdHeading, level: n.Level, runs: f.inline(n)})
	case *ast.ThematicBreak:
		f.add(mdBlock{kind: mdRule})
	case *ast.FencedCodeBlock:
		f.add(mdBlock{kind: mdCode, code: f.code(n, string(n.Language(f.src)))})
	case *ast.CodeBlock:
		f.add(mdBlock{kind: mdCode, code: f.code(n, "")})
	case *ast.HTMLBlock:
		raw := f.lines(n)
		if n.HasClosure() {
			raw += string(n.ClosureLine.Value(f.src))
		}
		f.add(mdBlock{kind: mdParagraph, runs: []mdRun{{text: strings.TrimRight(raw, "\n")}}})
	case *ast.Blockquote:
		f.in = append(f.in, mdBox{quote: true, first: true})
		f.children(n)
		f.in = f.in[:len(f.in)-1]
	case *ast.List:
		f.list(n)
	case *extast.Table:
		f.add(mdBlock{kind: mdTable, table: f.table(n)})
	default:
		f.children(n)
	}
}

// list puts each item's blocks after its marker: a bullet by how deep the
// list is, or its number.
func (f *flattener) list(n *ast.List) {
	count := n.ChildCount()
	width := float32(20)
	if n.IsOrdered() {
		width = max(width, float32(len(fmt.Sprint(n.Start+count-1)))*7+12)
	}
	depth := 0
	for _, box := range f.in {
		if !box.quote {
			depth++
		}
	}

	// An item hugs the paragraph that leads into it
	tight := f.tight
	first := float32(8)
	switch {
	case n.HasBlankPreviousLines() || f.cut && n.PreviousSibling() == nil && n.Parent().Type() == ast.TypeDocument:
		first = 12
	case tight:
		first = 4
	}
	i := 0
	for item := n.FirstChild(); item != nil; item = item.NextSibling() {
		marker := []string{"•", "◦", "▪"}[min(depth, 2)]
		if n.IsOrdered() {
			marker = fmt.Sprintf("%d%c", n.Start+i, n.Marker)
		}
		f.in = append(f.in, mdBox{first: true, marker: marker, width: width})
		switch {
		case i == 0:
			f.pending = first
		case n.IsTight:
			f.pending = 4
		}
		f.tight = n.IsTight
		f.children(item)
		f.in = f.in[:len(f.in)-1]
		i++
	}
	f.tight = tight
}

// add puts b after the blocks, in the boxes it is in, with the room above
// it that follows from the block before.
func (f *flattener) add(b mdBlock) {
	if len(f.in) > 0 {
		b.in = append([]mdBox(nil), f.in...)
		if last := &b.in[len(b.in)-1]; !last.quote && last.first {
			last.task = f.task
		}
		for i := range f.in {
			f.in[i].first = false
		}
	}
	f.task = noTask

	b.gap = 12
	var before *mdBlock
	if n := len(f.out); n > 0 {
		before = &f.out[n-1]
	}
	switch {
	case before == nil:
		b.gap = 0
	case b.kind == mdHeading && b.level <= 2:
		b.gap = 24
	case b.kind == mdHeading:
		b.gap = 20
	case before.kind == mdHeading:
		b.gap = 8
	case f.pending >= 0:
		b.gap = f.pending
	case f.tight:
		b.gap = 4
	}
	f.pending = -1
	f.out = append(f.out, b)
}

// code is a code block's text, taking the next code block kept for its
// colors: whole once its fence closes or nothing more of it comes.
func (f *flattener) code(n ast.Node, lang string) *fenced {
	code := f.lines(n)
	lines := n.Lines()
	whole := f.whole || lines.Len() > 0 && lines.At(lines.Len()-1).Stop < len(f.src)
	if whole {
		code = strings.TrimSuffix(code, "\n")
	}

	var block *fenced
	if len(f.codes) > 0 && f.codes[0].lang == lang {
		block, f.codes = f.codes[0], f.codes[1:]
	} else {
		block = &fenced{lang: lang, block: &syntax.Block{Lang: syntax.Language(lang)}}
	}
	block.text = code
	block.block.Grow(code, whole)
	f.took = append(f.took, block)
	return block
}

func (f *flattener) lines(n ast.Node) string {
	var b strings.Builder
	lines := n.Lines()
	for i := range lines.Len() {
		seg := lines.At(i)
		b.Write(seg.Value(f.src))
	}
	return b.String()
}

func (f *flattener) table(n *extast.Table) *mdRows {
	t := &mdRows{align: n.Alignments}
	for row := n.FirstChild(); row != nil; row = row.NextSibling() {
		var cells [][]mdRun
		for cell := row.FirstChild(); cell != nil; cell = cell.NextSibling() {
			cells = append(cells, f.inline(cell))
		}
		t.rows = append(t.rows, cells)
	}
	return t
}

// inline is the runs of n's text, each in one style.
func (f *flattener) inline(n ast.Node) []mdRun {
	var runs []mdRun
	add := func(text string, style mdStyle, url string) {
		if text == "" {
			return
		}
		if last := len(runs) - 1; last >= 0 && runs[last].style == style && runs[last].url == url {
			runs[last].text += text
			return
		}
		runs = append(runs, mdRun{text, style, url})
	}

	var walk func(n ast.Node, style mdStyle, url string)
	walk = func(n ast.Node, style mdStyle, url string) {
		for c := n.FirstChild(); c != nil; c = c.NextSibling() {
			switch c := c.(type) {
			case *ast.Text:
				value := c.Segment.Value(f.src)
				if !c.IsRaw() {
					value = util.ResolveEntityNames(util.ResolveNumericReferences(util.UnescapePunctuations(value)))
				}
				add(string(value), style, url)
				if c.SoftLineBreak() || c.HardLineBreak() {
					add("\n", style, url)
				}
			case *ast.String:
				add(string(c.Value), style, url)
			case *ast.CodeSpan:
				for t := c.FirstChild(); t != nil; t = t.NextSibling() {
					if t, ok := t.(*ast.Text); ok {
						add(strings.ReplaceAll(string(t.Segment.Value(f.src)), "\n", " "), style|styleCode, url)
					}
				}
			case *ast.Emphasis:
				if c.Level >= 2 {
					walk(c, style|styleStrong, url)
				} else {
					walk(c, style|styleEmphasis, url)
				}
			case *ast.Link:
				walk(c, style|styleLink, string(c.Destination))
			case *ast.AutoLink:
				add(string(c.Label(f.src)), style|styleLink, string(c.URL(f.src)))
			case *ast.RawHTML:
				for i := range c.Segments.Len() {
					seg := c.Segments.At(i)
					add(string(seg.Value(f.src)), style, url)
				}
			case *extast.Strikethrough:
				walk(c, style|styleStrike, url)
			case *extast.TaskCheckBox:
				f.task = taskOpen
				if c.IsChecked {
					f.task = taskDone
				}
			default:
				walk(c, style, url)
			}
		}
	}
	walk(n, 0, "")
	return runs
}

// pieceSize is how long a paragraph runs before it is cut, at the next line
// break: a text is laid out again whole as it changes, so a paragraph that
// streams in has only its last piece laid out again.
const pieceSize = 2048

// pieces cuts runs at the first line break past every pieceSize bytes; a
// piece once cut stays the same as the runs grow.
func pieces(runs []mdRun) [][]mdRun {
	var out [][]mdRun
	var piece []mdRun
	size := 0
	for _, r := range runs {
		for size+len(r.text) > pieceSize {
			at := max(pieceSize-size, 0)
			n := strings.IndexByte(r.text[at:], '\n')
			if n < 0 {
				break
			}
			if head := r.text[:at+n]; head != "" {
				piece = append(piece, mdRun{head, r.style, r.url})
			}
			out, piece, size = append(out, piece), nil, 0
			r.text = r.text[at+n+1:]
		}
		if r.text != "" {
			piece = append(piece, r)
			size += len(r.text)
		}
	}
	return append(out, piece)
}
