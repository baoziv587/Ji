package syntax

import (
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestLanguageByFenceOrPath(t *testing.T) {
	for text, want := range map[string]string{
		"go":                  "Go",
		"ts":                  "TypeScript",
		`tsx title="a.tsx"`:   "TypeScript",
		"/code/web/Login.tsx": "TypeScript",
		"src/main.go":         "Go",
		"Dockerfile":          "Docker",
		"bash":                "Bash",
		"":                    "",
		"notes.unknownext":    "",
	} {
		if got := Language(text).Name(); got != want {
			t.Errorf("Language(%q) = %q, want %q", text, got, want)
		}
	}
}

func TestLinesKeepEveryLineAndItsKinds(t *testing.T) {
	lines := Lines(Language("go"), "func main() {\n\treturn \"hi\" // done\n}")
	if len(lines) != 3 {
		t.Fatalf("%d lines", len(lines))
	}
	want := Line{
		{"    ", Plain},
		{"return", Keyword},
		{" ", Plain},
		{`"hi"`, String},
		{" ", Plain},
		{"// done", Comment},
	}
	if !reflect.DeepEqual(lines[1], want) {
		t.Errorf("line 2 %+v", lines[1])
	}
	texts := strings.Split("func main() {\n    return \"hi\" // done\n}", "\n")
	for i, line := range lines {
		text := ""
		for _, s := range line {
			text += s.Text
		}
		if want := texts[i]; text != want {
			t.Errorf("line %d reads %q, want %q", i+1, text, want)
		}
	}
}

func TestLinesPlainWithoutALanguage(t *testing.T) {
	lines := Lines(nil, "a\n\nb\n")
	if want := []Line{{{"a", Plain}}, nil, {{"b", Plain}}, nil}; !reflect.DeepEqual(lines, want) {
		t.Errorf("%+v", lines)
	}
}

func TestLinesPastTheLimitArePlain(t *testing.T) {
	text := strings.Repeat("x := 1\n", limit/7+10) + "return"
	lines := Lines(Language("go"), text)
	if n := strings.Count(text, "\n") + 1; len(lines) != n {
		t.Fatalf("%d lines, want %d", len(lines), n)
	}
	if lines[len(lines)-1][0] != (Span{"return", Plain}) || lines[0][1].Kind != Punctuation {
		t.Errorf("first %+v, last %+v", lines[0], lines[len(lines)-1])
	}
}

// A block streaming in past the limit is not lexed again: its lines past
// it are put after those colored, plain, the lines before as they were.
func TestBlockPastTheLimitIsLexedOnce(t *testing.T) {
	lexed := 0
	Background = func(fn func()) { lexed++; fn() }
	defer func() { Background = func(fn func()) { go fn() } }()

	text := strings.Repeat("x := 1\n", limit/7+10)
	b := &Block{Lang: Language("go")}
	b.Grow(text, false)
	first := b.Lines()
	head := &first[0][0]
	for _, line := range []string{"y := 2\n", "\tz\n"} {
		text += line
		b.Grow(text, false)
		b.Lines()
	}
	b.Grow(text+"return", true)
	lines := b.Lines()
	if lexed != 1 || &lines[0][0] != head || len(lines) != strings.Count(text, "\n")+1 {
		t.Fatalf("lexed %d times, %d lines", lexed, len(lines))
	}
	want := []Line{{{"y := 2", Plain}}, {{"    z", Plain}}, {{"return", Plain}}}
	if got := lines[len(lines)-3:]; !reflect.DeepEqual(got, want) {
		t.Errorf("the last lines %+v", got)
	}
}

// A block that is slow to lex rests before it is lexed again, its new
// lines plain meanwhile, and is drawn again once it may be.
func TestASlowBlockRestsBetweenLexings(t *testing.T) {
	lexed := 0
	Background = func(fn func()) { lexed++; fn() }
	defer func() { Background = func(fn func()) { go fn() } }()
	ready := make(chan struct{}, 1)
	Ready = func() {
		select {
		case ready <- struct{}{}:
		default:
		}
	}
	defer func() { Ready = func() {} }()

	text := strings.Repeat("x := \"a string\" + 1 // and a comment\n", 1200)
	b := &Block{Lang: Language("go")}
	b.Grow(text, false)
	b.Lines()
	<-ready
	if b.next.IsZero() {
		t.Skip("lexed faster than slowLex here")
	}

	text += "return\n"
	b.Grow(text, false)
	lines := b.Lines()
	if lexed != 1 || lines[len(lines)-2][0] != (Span{"return", Plain}) {
		t.Fatalf("lexed %d times, the new line %+v", lexed, lines[len(lines)-2])
	}
	select {
	case <-ready:
	case <-time.After(2 * time.Second):
		t.Fatal("not drawn again once it may be lexed")
	}
	if lines := b.Lines(); lexed != 2 || lines[len(lines)-2][0].Kind != Keyword {
		t.Errorf("lexed %d times, the new line %+v", lexed, lines[len(lines)-2])
	}
}

// What is shown changes its version, and the colored lines before the one
// being written stay the same as the text grows.
func TestBlockShowsTheSameLinesAsItGrows(t *testing.T) {
	var later []func()
	Background = func(fn func()) { later = append(later, fn) }
	defer func() { Background = func(fn func()) { go fn() } }()

	b := &Block{Lang: Language("go")}
	b.Grow("x := 1\ny := 2\n", false)
	b.Lines()
	later[0]()
	lines, v := b.Lines(), b.Version()
	first := &lines[0][0]
	if b.Lines(); b.Version() != v {
		t.Errorf("version %d for the same lines, was %d", b.Version(), v)
	}
	b.Grow("x := 1\ny := 2\nz", false)
	lines = b.Lines()
	if b.Version() == v || &lines[0][0] != first || len(lines) != 3 ||
		lines[2][0] != (Span{"z", Plain}) {
		t.Errorf("version %d, lines %+v", b.Version(), lines)
	}
	b.Grow("x := 1\ny := 2\nzz", false)
	if lines = b.Lines(); &lines[0][0] != first || lines[2][0] != (Span{"zz", Plain}) {
		t.Errorf("lines %+v", lines)
	}
}

// As a block streams in a line at a time, the line not ended yet is
// plain; a comment closed on a later line colors again the lines it opened
// on.
func TestBlockColorsALineOnceItEnds(t *testing.T) {
	Background = func(fn func()) { fn() }
	b := &Block{Lang: Language("go")}
	b.Grow("/* a\nb */ x", false)
	lines := b.Lines()
	if len(lines) != 2 || lines[1][0] != (Span{"b */ x", Plain}) {
		t.Fatalf("lines %+v", lines)
	}

	b.Grow("/* a\nb */ x := 1\n", false)
	lines = b.Lines()
	if len(lines) != 3 || lines[0][0] != (Span{"/* a", Comment}) ||
		lines[1][0] != (Span{"b */", Comment}) ||
		lines[2] != nil {
		t.Errorf("lines %+v", lines)
	}

	b.Grow("/* a\nb */ x := 1\nreturn", true)
	if lines = b.Lines(); lines[2][0] != (Span{"return", Keyword}) {
		t.Errorf("the last line %+v once whole", lines[2])
	}
}

// What the lexer has not reached shows plain, and is colored when it is.
func TestBlockShowsPlainUntilLexed(t *testing.T) {
	var later []func()
	Background = func(fn func()) { later = append(later, fn) }
	defer func() { Background = func(fn func()) { go fn() } }()
	ready := 0
	Ready = func() { ready++ }

	b := NewBlock(Language("go"), "return 1")
	if lines := b.Lines(); lines[0][0] != (Span{"return 1", Plain}) || len(later) != 1 {
		t.Fatalf("lines %+v before, %d lexing", lines, len(later))
	}
	b.Lines()
	if len(later) != 1 {
		t.Errorf("lexed %d times at once", len(later))
	}
	later[0]()
	if lines := b.Lines(); lines[0][0] != (Span{"return", Keyword}) || ready != 1 {
		t.Errorf("lines %+v after, ready %d", lines, ready)
	}
}

// On its goroutine, the lexer tells when it is done, and the lines show
// in color after; a stream grows as it lexes.
func TestBlockLexesInTheBackground(t *testing.T) {
	ready := make(chan struct{}, 8)
	Ready = func() { ready <- struct{}{} }
	defer func() { Ready = func() {} }()

	b := &Block{Lang: Language("go")}
	b.Grow("x := 1\n", false)
	b.Lines()
	b.Grow("x := 1\ny := 2\n", false)
	for range 2 {
		<-ready
		b.Lines()
	}
	if lines := b.Lines(); len(lines) != 3 || lines[1][0] != (Span{"y ", Plain}) ||
		lines[1][3] != (Span{"2", Number}) {
		t.Errorf("lines %+v", lines)
	}
}

// A line ended in a block streaming in past the limit costs no lexing.
func BenchmarkALineEndedPastTheLimit(b *testing.B) {
	Background = func(fn func()) { fn() }
	defer func() { Background = func(fn func()) { go fn() } }()
	head := strings.Repeat("x := map[string]int{\"a\": 1} // c\n", limit/30)
	text := head + strings.Repeat("y := 2\n", b.N)
	block := &Block{Lang: Language("go")}
	block.Grow(head, false)
	block.Lines()
	b.ReportAllocs()
	b.ResetTimer()
	for i := range b.N {
		block.Grow(text[:len(head)+7*(i+1)], false)
		block.Lines()
	}
}
