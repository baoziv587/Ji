import type { Plugin } from 'vite'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { createHighlighter } from 'shiki'

const QUERY = '?highlight'
const HOOK_HELPERS = new Set(['before', 'after', 'intercept'])
const LANGUAGES: Record<string, string> = { '.ts': 'ts', '.sh': 'bash' }

// Colors are CSS variables defined in src/styles.css, so the page and the
// code share one palette. Structure recedes into aged paper; mineral pigments
// separate token kinds; qinglv is reserved for hook helpers (see .code .hook).
const v = (name: string) => `var(--code-${name})`

const inkTheme = {
  name: 'ink',
  type: 'dark' as const,
  colors: {
    'editor.background': 'var(--ink-0)',
    'editor.foreground': v('name'),
  },
  tokenColors: [
    {
      scope: ['comment', 'punctuation.definition.comment'],
      settings: {
        foreground: v('comment'),
        fontStyle: 'italic',
      },
    },
    {
      scope: [
        'punctuation',
        'meta.brace',
        'keyword.operator',
        'storage.type.function.arrow',
        'keyword.generator.asterisk',
      ],
      settings: {
        foreground: v('punctuation'),
      },
    },
    {
      scope: ['keyword', 'storage', 'keyword.operator.expression', 'keyword.operator.new'],
      settings: {
        foreground: v('keyword'),
      },
    },
    {
      scope: ['string', 'punctuation.definition.string'],
      settings: {
        foreground: v('string'),
      },
    },
    {
      scope: ['constant.numeric', 'constant.language', 'variable.other.constant.object'],
      settings: {
        foreground: v('constant'),
      },
    },
    {
      scope: ['entity.name.function', 'support.function', 'entity.name.command', 'entity.name.type', 'support.type'],
      settings: {
        foreground: v('function'),
      },
    },
    {
      scope: ['variable', 'meta.object-literal.key', 'support.variable', 'string.unquoted.argument.shell'],
      settings: {
        foreground: v('name'),
      },
    },
  ],
}

/**
 * Snippets compile against the real packages (src/snippets/tsconfig.json), so some start with imports the page should
 * not show. Everything up to and including the `// @snippet` line is that preamble.
 */
const MARKER = '// @snippet\n'

function shown(source: string): string {
  const at = source.indexOf(MARKER)
  return (at === -1 ? source : source.slice(at + MARKER.length)).trimEnd()
}

const HIGHLIGHT_LANGS = ['ts', 'bash'] as const

let highlighter: ReturnType<typeof createHighlighter> | undefined

/** One Shiki instance for snippets and docs, so both share the ink theme. */
export async function codeHighlighter() {
  highlighter ??= createHighlighter({
    themes: [inkTheme],
    langs: [...HIGHLIGHT_LANGS],
  })
  const instance = await highlighter
  const supported = new Set<string>(HIGHLIGHT_LANGS)
  return (code: string, lang: string) =>
    instance.codeToHtml(code, {
      lang: supported.has(lang) ? lang : 'text',
      theme: 'ink',
      transformers: [
        {
          span(node, _line, _col, _lineElement, token) {
            if (HOOK_HELPERS.has(token.content.trim())) this.addClassToHast(node, 'hook')
          },
        },
      ],
    })
}

/**
 * `import html from './snippet.ts?highlight'` returns the file as highlighted
 * HTML, rendered at build time so no highlighter ships to the browser.
 */
export function highlight(): Plugin {
  return {
    name: 'ji:highlight',
    enforce: 'pre',
    async load(id) {
      if (!id.endsWith(QUERY)) return
      const file = id.slice(0, -QUERY.length)
      const lang = LANGUAGES[extname(file)]
      if (!lang) throw new Error(`No highlight language for ${file}`)

      this.addWatchFile(file)
      const toHtml = await codeHighlighter()
      const html = toHtml(shown(await readFile(file, 'utf8')), lang)
      return `export default ${JSON.stringify(html)}`
    },
  }
}
