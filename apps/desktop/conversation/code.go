package conversation

// Code in color, as the terminal colors it: the lines of a diff in the
// language of the file it changes, a command as shell. The blocks fenced in
// the reply are Markdown's (markdown.go). The lexing is the syntax
// package's, in the background.

import (
	"strings"
	"unicode/utf8"

	"desktop/syntax"
)

// colorDiff colors a diff's code in lang, as the terminal does: a hunk's
// removed lines run on in the file before, its added ones in the file
// after, so each run is colored as one block, and the k-th added line
// marks where it differs from the k-th removed one, which it took the
// place of. Its other lines, a command's, are a block of their own.
func colorDiff(lines []DiffLine, lang *syntax.Lang) {
	start := 0
	for i := range len(lines) + 1 {
		if i == len(lines) || lines[i].Kind == DiffMeta {
			colorHunk(lines[start:i], lang)
			start = i + 1
		}
	}
}

func colorHunk(lines []DiffLine, lang *syntax.Lang) {
	var removed, added, plain []int
	for i, line := range lines {
		switch line.Kind {
		case DiffRemoved:
			removed = append(removed, i)
		case DiffAdded:
			added = append(added, i)
		default:
			plain = append(plain, i)
		}
	}

	run := func(run []int, sign int) {
		if len(run) == 0 {
			return
		}
		code := make([]string, len(run))
		for k, i := range run {
			code[k] = strings.ReplaceAll(lines[i].Text[sign:], "\t", "    ")
		}
		block := syntax.NewBlock(lang, strings.Join(code, "\n"))
		for k, i := range run {
			lines[i].Code, lines[i].At = block, k
		}
	}
	run(removed, 1)
	run(added, 1)
	run(plain, 0)

	for k := range min(len(removed), len(added)) {
		before, after := &lines[removed[k]], &lines[added[k]]
		before.Changed, after.Changed = changed(before.code(), after.code())
	}
}

// code is the line after its sign, as colored.
func (line *DiffLine) code() string {
	return strings.ReplaceAll(line.Text[1:], "\t", "    ")
}

// changed is where a and b differ: what is left of each between the start
// and the end the two share, in bytes. None when they share nothing, the
// whole line changed, or nothing.
func changed(a, b string) (inA, inB [2]int) {
	start := 0
	for start < len(a) && start < len(b) && a[start] == b[start] {
		start++
	}
	for start > 0 && start < len(a) && !utf8.RuneStart(a[start]) {
		start--
	}
	end := 0
	for end < len(a)-start && end < len(b)-start && a[len(a)-1-end] == b[len(b)-1-end] {
		end++
	}
	for end > 0 && !utf8.RuneStart(a[len(a)-end]) {
		end--
	}
	if start == 0 && end == 0 || a == b {
		return
	}
	return [2]int{start, len(a) - end}, [2]int{start, len(b) - end}
}
