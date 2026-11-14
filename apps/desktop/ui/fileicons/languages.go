package fileicons

import "strings"

// The theme gives some icons by VS Code's language rather than by
// extension; these are the files VS Code itself takes for those
// languages, by name and by extension.
var (
	languageNames = map[string]string{
		"makefile":           "makefile",
		"gnumakefile":        "makefile",
		"containerfile":      "dockerfile",
		"compose.yaml":       "dockercompose",
		"compose.yml":        "dockercompose",
		"docker-compose.yml": "dockercompose",
		"commit_editmsg":     "git-commit",
		"merge_msg":          "git-commit",
		"git-rebase-todo":    "git-rebase",
		"gemfile":            "ruby",
		"rakefile":           "ruby",
		".bashrc":            "shellscript",
		".zshrc":             "shellscript",
		".profile":           "shellscript",
		".npmignore":         "ignore",
	}
	languageExtensions = map[string]string{
		"php": "php", "phtml": "php",
		"vue":   "vue",
		"jsonc": "json", "json5": "json", "webmanifest": "json",
		"hpp": "cpp", "hh": "cpp", "hxx": "cpp", "cc": "cpp", "cxx": "cpp", "ino": "cpp",
		"m": "objective-c", "mm": "objective-cpp",
		"mk":  "makefile",
		"htm": "html", "xhtml": "html",
		"xsd": "xml", "plist": "xml", "xaml": "xml",
		"markdown": "markdown", "mdown": "markdown", "mkd": "markdown",
		"pyi": "python", "pyw": "python",
		"mts": "typescript", "cts": "typescript",
		"es6":     "javascript",
		"gemspec": "ruby",
		"pl":      "perl", "pm": "perl",
		"cs": "csharp", "csx": "csharp",
		"fs": "fsharp", "fsi": "fsharp", "fsx": "fsharp",
		"ps1": "powershell", "psm1": "powershell", "psd1": "powershell",
		"bat": "bat", "cmd": "bat",
		"ksh": "shellscript", "fish": "shellscript",
		"clj": "clojure", "cljs": "clojure", "cljc": "clojure", "edn": "clojure",
		"coffee": "coffeescript",
		"jl":     "julia",
		"r":      "r",
		"hbs":    "handlebars", "handlebars": "handlebars",
		"jade":   "pug",
		"cshtml": "razor",
		"vb":     "vb",
		"hlsl":   "hlsl",
		"tex":    "latex", "sty": "latex", "cls": "latex",
		"properties": "properties",
		"ipynb":      "jupyter",
		"tsv":        "tsv",
	}
)

// languageOf is VS Code's language of the file of base, a lower-case base
// name, "" when it has none of those above.
func languageOf(base string) string {
	if lang, ok := languageNames[base]; ok {
		return lang
	}
	if i := strings.LastIndexByte(base, '.'); i >= 0 {
		return languageExtensions[base[i+1:]]
	}
	return ""
}
