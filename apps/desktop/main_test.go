package main

import (
	"flag"
	"os"
	"path/filepath"
	"testing"
)

func TestFolderOfSkipsTheFlags(t *testing.T) {
	wd, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(wd, "project"), 0o755); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(wd, "notes.txt")
	if err := os.WriteFile(file, nil, 0o644); err != nil {
		t.Fatal(err)
	}

	flags := flag.NewFlagSet("", flag.ContinueOnError)
	flags.String("root", "", "")
	flags.String("model", "", "")
	flags.Bool("yolo", false, "")

	for _, c := range []struct {
		args []string
		want string
	}{
		{[]string{"project"}, filepath.Join(wd, "project")},
		{[]string{"-yolo", "-model", "deepseek/x", "project"}, filepath.Join(wd, "project")},
		{[]string{"-root", "project"}, ""},
		{[]string{file}, ""},
		{[]string{"missing"}, ""},
		{nil, ""},
	} {
		if got := folderOf(flags, c.args, wd); got != c.want {
			t.Errorf("folderOf(%q) = %q, want %q", c.args, got, c.want)
		}
	}
}
