package app

// What the window knows of each folder on the disk: whether it is still
// there, and the git branch it has checked out, read from the repository's
// HEAD; looked at off the main thread as the list changes, a session is
// chosen or a project edited.

import (
	"os"
	"path/filepath"
	"strings"
)

// readFolders looks at roots again, and keeps what it found.
func (a *App) readFolders(roots ...string) {
	if len(roots) == 0 {
		return
	}
	a.async(func() {
		branches := make(map[string]string, len(roots))
		missing := make(map[string]bool, len(roots))
		for _, root := range roots {
			missing[root] = !a.isDir(root)
			branches[root] = branchOf(root)
		}
		a.update(func() {
			for _, root := range roots {
				a.branches[root] = branches[root]
				a.missing[root] = missing[root]
			}
		})
	})
}

func isDir(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

// roots is each folder of the list and of the projects once.
func (a *App) roots() []string {
	seen := map[string]bool{}
	var roots []string
	add := func(root string) {
		if root != "" && !seen[root] {
			seen[root] = true
			roots = append(roots, root)
		}
	}
	for _, s := range a.list.Sessions {
		add(s.Root)
	}
	for _, p := range a.Projects {
		for _, folder := range p.Folders {
			add(folder)
		}
	}
	return roots
}

// branchOf is the branch checked out in the repository holding dir, the
// commit's first 7 digits when detached, "" outside one.
func branchOf(dir string) string {
	gitDir := findGitDir(dir)
	if gitDir == "" {
		return ""
	}
	head, err := os.ReadFile(filepath.Join(gitDir, "HEAD"))
	if err != nil {
		return ""
	}
	line := strings.TrimSpace(string(head))
	if ref, ok := strings.CutPrefix(line, "ref: "); ok {
		return strings.TrimPrefix(ref, "refs/heads/")
	}
	if len(line) >= 7 {
		return line[:7]
	}
	return ""
}

// findGitDir is the git directory of the repository holding dir: its
// .git, or where a worktree's .git file points.
func findGitDir(dir string) string {
	if !filepath.IsAbs(dir) {
		return ""
	}
	for {
		dotGit := filepath.Join(dir, ".git")
		info, err := os.Stat(dotGit)
		switch {
		case err != nil:
		case info.IsDir():
			return dotGit
		default:
			link, err := os.ReadFile(dotGit)
			if err != nil {
				return ""
			}
			to, ok := strings.CutPrefix(strings.TrimSpace(string(link)), "gitdir: ")
			if !ok {
				return ""
			}
			if !filepath.IsAbs(to) {
				to = filepath.Join(dir, to)
			}
			return to
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}
