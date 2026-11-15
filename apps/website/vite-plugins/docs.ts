import type { Plugin } from 'vite'
import type { Doc, DocHeading, DocPage } from '../src/lib/docs-types.ts'
import { readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, extname, join, posix } from 'node:path'
import GithubSlugger from 'github-slugger'
import { Marked } from 'marked'
import { codeHighlighter } from './highlight.ts'

interface DocsOptions {
  /** The repository's docs folder, e.g. `../../docs`. */
  dir: string
  /** GitHub URL of the repository, for links that leave the docs. */
  repo: string
  /** Sidebar order by file name without `.md`; files not listed follow alphabetically. */
  order: readonly string[]
  /** Files kept off the site, e.g. deep references. Links to them point at GitHub instead. */
  exclude?: readonly string[]
}

const INDEX_FILE = 'README'
const INDEX_ID = 'virtual:docs'
const PAGE_PREFIX = 'virtual:docs/'

/** `README` is the docs home at `/docs`; every other file is `/docs/<name>`. */
const slugOf = (name: string) => (name === INDEX_FILE ? '' : name)
const docPath = (slug: string) => (slug ? `/docs/${slug}` : '/docs')
/** The site path of a doc file name, e.g. `plugins` → `/docs/plugins`. */
export const pathOfDoc = (name: string) => docPath(slugOf(name))

/** Doc file names in sidebar order. Read synchronously so vite.config can list pages to prerender. */
export function listDocs({ dir, order, exclude = [] }: Pick<DocsOptions, 'dir' | 'order' | 'exclude'>): string[] {
  const names = readdirSync(dir)
    .filter(file => extname(file) === '.md')
    .map(file => basename(file, '.md'))
    .filter(name => !exclude.includes(name))
  const rank = (name: string) => {
    const at = order.indexOf(name)
    return at === -1 ? order.length : at
  }
  return names.toSorted((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

const decode = (html: string) =>
  html
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')

const ARROW =
  '<svg class="doc-external" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7h10v10"/><path d="M7 17 17 7"/></svg>'

/** The GitHub page uses these for its own chrome; the site has a sidebar and spacing instead. */
function stripRepoChrome(markdown: string) {
  return markdown
    .replace(/^\*\*English\*\* · .*$/m, '')
    .replaceAll(/^<br\s*\/?>\s*$/gm, '')
    .trim()
}

/**
 * Links between docs stay on the site (`plugins.md#ordering` → `/docs/plugins#ordering`).
 * Every other relative link points at the file on GitHub, since the site only hosts docs/.
 */
function rewriteHref(href: string, docNames: ReadonlySet<string>, repo: string) {
  if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('/')) return href

  const [path = '', hash = ''] = href.split('#', 2)
  const target = posix.normalize(posix.join('docs', path))
  const suffix = hash ? `#${hash}` : ''
  const docName = target.startsWith('docs/') && posix.dirname(target) === 'docs' ? basename(target, '.md') : undefined
  if (docName !== undefined && docNames.has(docName)) return docPath(slugOf(docName)) + suffix

  const kind = posix.extname(target) ? 'blob' : 'tree'
  return `${repo}/${kind}/main/${target}${suffix}`
}

async function renderDoc(source: string, name: string, docNames: ReadonlySet<string>, repo: string) {
  const toHtml = await codeHighlighter()
  const slugger = new GithubSlugger()
  const headings: DocHeading[] = []
  let title = name

  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens)
        const text = decode(this.parser.parseInline(tokens, this.parser.textRenderer))
        if (depth === 1) {
          title = text
          return ''
        }
        const id = slugger.slug(text)
        if (depth <= 3) headings.push({ id, text, depth })
        return `<h${depth} id="${id}">${inner}</h${depth}>\n`
      },
      code({ text, lang }) {
        return `<div class="doc-code code">${toHtml(text, lang ?? 'text')}</div>\n`
      },
      link({ href, title: linkTitle, tokens }) {
        const url = rewriteHref(href, docNames, repo)
        const inner = this.parser.parseInline(tokens)
        const titleAttr = linkTitle ? ` title="${linkTitle}"` : ''
        return /^https?:/.test(url)
          ? `<a href="${url}"${titleAttr}>${inner}${ARROW}</a>`
          : `<a href="${url}"${titleAttr}>${inner}</a>`
      },
    },
  })

  const html = await marked.parse(stripRepoChrome(source))
  return { slug: slugOf(name), title, html, headings } satisfies Doc
}

/**
 * Renders the repository's docs/*.md to HTML at build time, with the same ink
 * highlighting as the home page. `virtual:docs` lists the pages; each page is
 * its own chunk (`virtual:docs/<slug>`), so the browser never parses Markdown.
 */
export function docs(options: DocsOptions): Plugin {
  const names = () => listDocs(options)
  const fileOf = (name: string) => join(options.dir, `${name}.md`)

  return {
    name: 'ji:docs',
    enforce: 'pre',
    resolveId(id) {
      if (id === INDEX_ID || id.startsWith(PAGE_PREFIX)) return `\0${id}`
    },
    async load(id) {
      if (!id.startsWith('\0virtual:docs')) return
      const all = names()
      const docNames = new Set(all)

      if (id === `\0${INDEX_ID}`) {
        const pages = await Promise.all(
          all.map(async name => {
            this.addWatchFile(fileOf(name))
            const source = await readFile(fileOf(name), 'utf8')
            const title = /^# (.+)$/m.exec(source)?.[1]?.replaceAll('`', '').trim() ?? name
            return { slug: slugOf(name), title } satisfies DocPage
          }),
        )
        const loaders = all
          .map(name => `${JSON.stringify(slugOf(name))}: () => import(${JSON.stringify(PAGE_PREFIX + name)})`)
          .join(',\n  ')
        return `export const pages = ${JSON.stringify(pages)}\nexport const loaders = {\n  ${loaders}\n}\n`
      }

      const name = id.slice(`\0${PAGE_PREFIX}`.length)
      if (!docNames.has(name)) throw new Error(`No doc named ${name} in ${options.dir}`)
      this.addWatchFile(fileOf(name))
      const doc = await renderDoc(await readFile(fileOf(name), 'utf8'), name, docNames, options.repo)
      return `export default ${JSON.stringify(doc)}`
    },
  }
}
