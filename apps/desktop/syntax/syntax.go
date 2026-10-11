// Package syntax colors code by chroma's lexers, as the terminal colors it
// by shiki's grammars: the language from a fence or a file's name, and each
// line of a block cut where the kind of its words changes. What a kind
// looks like is the view's to say.
package syntax

import (
	"path"
	"strings"
	"sync"

	"github.com/alecthomas/chroma/v2"
	"github.com/alecthomas/chroma/v2/lexers"
)

type Kind uint8

const (
	Plain Kind = iota
	Keyword
	String
	// Numbers and the other literals, and constants.
	Number
	// Types, classes and the builtins.
	Type
	Comment
	Punctuation
)

// Span is a run of a line's text of one kind.
type Span struct {
	Text string
	Kind Kind
}

// Line is a line of code in spans.
type Line []Span

// Lang is a language chroma knows.
type Lang struct{ lexer chroma.Lexer }

// limit is how much of a block is colored: past it, the lines are plain,
// so a block that streams in, lexed again as each line ends, costs no
// more than this each time.
const limit = 64 << 10

var languages sync.Map

// Language is the language of a fence's info string (`ts`, `tsx
// title="a.tsx"`) or of a file's path, by its name or alias first and then
// its file's name or extension; nil for one chroma does not know.
func Language(text string) *Lang {
	word, _, _ := strings.Cut(strings.TrimSpace(text), " ")
	name := strings.ToLower(path.Base(word))
	if name == "" || name == "." || name == "/" {
		return nil
	}
	if lang, ok := languages.Load(name); ok {
		return lang.(*Lang)
	}

	var lang *Lang
	if lexer := lexers.Get(name); lexer != nil && lexer.Config().Name != "plaintext" {
		lang = &Lang{lexer}
	}
	languages.Store(name, lang)
	return lang
}

// Name is what the language is called.
func (l *Lang) Name() string {
	if l == nil {
		return ""
	}
	return l.lexer.Config().Name
}

// Lines is each line of text, in lang; plain when lang is nil. Tabs are
// four spaces, which text drawn does not know.
func Lines(lang *Lang, text string) []Line {
	text = strings.ReplaceAll(text, "\t", "    ")
	n := strings.Count(text, "\n") + 1
	head := text
	if len(head) > limit {
		head = head[:strings.LastIndexByte(head[:limit], '\n')+1]
	}

	colored := strings.Count(head, "\n") + 1
	lines := tokenise(lang, head)
	if len(lines) < colored {
		return add(make([]Line, 1, n), text, Plain)
	}
	// The lexer may end what it lexes with a line break of its own
	return add(lines[:colored], text[len(head):], Plain)
}

// tokenise is text in lang, in lines; none when lang is nil or the lexer
// fails.
func tokenise(lang *Lang, text string) []Line {
	if lang == nil {
		return nil
	}
	it, err := lang.lexer.Tokenise(nil, text)
	if err != nil {
		return nil
	}
	lines := make([]Line, 1, strings.Count(text, "\n")+2)
	for t := it(); t != chroma.EOF; t = it() {
		lines = add(lines, t.Value, kindOf(t.Type))
	}
	return lines
}

// add puts text of kind at the end of lines, starting a line at each
// break.
func add(lines []Line, text string, kind Kind) []Line {
	for i, piece := range strings.Split(text, "\n") {
		if i > 0 {
			lines = append(lines, nil)
		}
		if piece == "" {
			continue
		}
		last := &lines[len(lines)-1]
		if n := len(*last); n > 0 && (*last)[n-1].Kind == kind {
			(*last)[n-1].Text += piece
		} else {
			*last = append(*last, Span{piece, kind})
		}
	}
	return lines
}

func kindOf(t chroma.TokenType) Kind {
	switch {
	case t.InCategory(chroma.Comment):
		if t == chroma.CommentPreproc || t == chroma.CommentPreprocFile {
			return Keyword
		}
		return Comment
	case t == chroma.KeywordType:
		return Type
	case t == chroma.KeywordConstant:
		return Number
	case t.InCategory(chroma.Keyword), t == chroma.OperatorWord, t == chroma.NameDecorator, t == chroma.NameTag:
		return Keyword
	case t.InSubCategory(chroma.LiteralString):
		if t == chroma.LiteralStringEscape || t == chroma.LiteralStringInterpol {
			return Number
		}
		return String
	case t.InCategory(chroma.Literal), t == chroma.NameConstant, t == chroma.NameBuiltinPseudo, t == chroma.NameEntity:
		return Number
	case t == chroma.NameBuiltin, t == chroma.NameClass, t == chroma.NameNamespace, t == chroma.NameException, t == chroma.NameAttribute:
		return Type
	case t == chroma.Punctuation, t == chroma.Operator:
		return Punctuation
	}
	return Plain
}

// Block is a block of code, colored in the background: chroma lexes about
// a megabyte a second, so a file written whole would take more than a
// frame. Not until it is first drawn, and the lines the lexer has not
// reached yet show plain. One that streams in has a line colored once it
// ends, as the terminal colors it, in what the lines before it opened, a
// string or a comment: chroma's lexers match across line breaks, so the
// block is lexed again from its start.
type Block struct {
	Lang *Lang
	mu   sync.Mutex
	text string
	// Whether text is all of it, its last line ended.
	whole bool
	// The lines of text colored, and how much of it they cover.
	colored []Line
	covered int
	lexing  bool
	// The lines as last shown, and the length of the text and of what was
	// colored they were for.
	shown    []Line
	shownFor [2]int
}

// NewBlock is the block of code text, whole.
func NewBlock(lang *Lang, text string) *Block {
	return &Block{Lang: lang, text: text, whole: true}
}

// Background runs the lexing: on a goroutine, or at once in tests.
var Background = func(fn func()) { go fn() }

// Ready is told when more of a block is colored, to draw it.
var Ready = func() {}

// slots is how many blocks are lexed at once, at most.
var slots = make(chan struct{}, 2)

// Grow takes the block of a stream so far; whole once it ends.
func (b *Block) Grow(text string, whole bool) {
	b.mu.Lock()
	b.text, b.whole = text, whole
	b.fit()
	b.mu.Unlock()
}

// fit keeps what is colored to the text: the line break it ended with,
// which a block that closes leaves out.
func (b *Block) fit() {
	if b.covered > len(b.text) {
		b.colored, b.covered = b.colored[:min(len(b.colored), strings.Count(b.text, "\n")+1)], len(b.text)
	}
}

// Lines are the block's lines: colored as far as the lexer has got, plain
// after it. Each line of the text, so a line ending it is an empty one.
func (b *Block) Lines() []Line {
	b.mu.Lock()
	defer b.mu.Unlock()
	end := len(b.text)
	if !b.whole {
		end = strings.LastIndexByte(b.text, '\n') + 1
	}
	switch {
	case b.covered >= end || b.lexing:
	case b.Lang == nil:
		// Plain needs no lexer
		b.colored, b.covered = Lines(nil, b.text[:end]), end
	default:
		b.lexing = true
		text := b.text[:end]
		b.mu.Unlock()
		Background(func() { b.lex(text) })
		b.mu.Lock()
	}

	if b.shown != nil && b.shownFor == [2]int{len(b.text), b.covered} {
		return b.shown
	}
	b.shown, b.shownFor = b.colored, [2]int{len(b.text), b.covered}
	if b.covered < len(b.text) || b.colored == nil {
		// The lexer's last line is the start of the one it has not reached
		n := max(len(b.colored)-1, 0)
		b.shown = append(b.colored[:n:n], Lines(nil, b.text[b.covered:])...)
	}
	return b.shown
}

func (b *Block) lex(text string) {
	slots <- struct{}{}
	lines := Lines(b.Lang, text)
	<-slots

	b.mu.Lock()
	b.colored, b.covered, b.lexing = lines, len(text), false
	b.fit()
	b.mu.Unlock()
	Ready()
}
