// Code in color, by shiki: Markdown's code blocks, a file's lines, the lines of a diff.
//
//   loadLanguage   once per block, since a grammar loads asynchronously; what it gives then paints without waiting
//   languageOf     a fence's info string or a file's path, to the language shiki knows it by
//
// The tokens are painted here instead of by @shikijs/cli's codeToANSI, which paints the same tokens, for two things it
// has no way to say: a grammar state carried from one line to the next, for a block that streams in a line at a time,
// and a background on part of a line, for what a diff changed.

import type { BundledLanguage, GrammarState, Highlighter } from 'shiki'
import process from 'node:process'
import { bundledLanguages, createHighlighter } from 'shiki'

/** A background over part of a line: from `start` to `end`, in UTF-16 units. A later one covers an earlier. */
export interface Background {
  start: number
  end: number
  color: string
}

/** Paints the next line of a block, in the state the lines before it left. */
export type PaintLine = (line: string, backgrounds?: readonly Background[]) => string

/** The terminal's background, from COLORFGBG where the terminal sets it (`15;0`); dark when it does not. */
const LIGHT = ['7', '15'].includes(process.env.COLORFGBG?.split(';').at(-1) ?? '')

const THEME = LIGHT ? 'github-light' : 'github-dark'

/** A diff's lines on its side's background, and the part a line changed on a stronger one: GitHub's colors. */
export const DIFF_COLORS = LIGHT
  ? { removed: { line: '#ffebe9', changed: '#ffcecb' }, added: { line: '#e6ffec', changed: '#abf2bc' } }
  : { removed: { line: '#3c1e22', changed: '#6e2f33' }, added: { line: '#16331f', changed: '#1f5f30' } }

/** A token's style bits, as vscode-textmate numbers them, each with its SGR code. */
const STYLES = [
  [2, '1'], // bold
  [1, '3'], // italic
  [4, '4'], // underline
] as const

let highlighter: Promise<Highlighter> | undefined

/**
 * Loads `lang`, and gives a way to start blocks in it: each block keeps its own grammar state. Plain text, with only
 * the backgrounds, when `lang` is undefined.
 */
export async function loadCodePainter(lang: BundledLanguage | undefined): Promise<() => PaintLine> {
  if (lang === undefined) {
    return () =>
      (line, backgrounds = []) =>
        paintTokens([{ content: line }], backgrounds)
  }

  highlighter ??= createHighlighter({ themes: [THEME], langs: [] })
  const shiki = await highlighter
  await shiki.loadLanguage(lang)
  // Text in the theme's own foreground is left in the terminal's, which is sure to read on its background
  const plain = shiki.getTheme(THEME).fg.toLowerCase()

  return () => {
    let state: GrammarState | undefined
    return (line, backgrounds = []) => {
      const { tokens, grammarState } = shiki.codeToTokens(line, { lang, theme: THEME, grammarState: state })
      state = grammarState
      const colored = (tokens[0] ?? []).map(t => ({
        ...t,
        color: t.color?.toLowerCase() === plain ? undefined : t.color,
      }))
      return paintTokens(colored, backgrounds)
    }
  }
}

/** Every line of `code`, painted as one block. */
export async function highlightCode(code: string, lang: BundledLanguage | undefined): Promise<string[]> {
  const paint = (await loadCodePainter(lang))()
  return code.split('\n').map(line => paint(line))
}

/**
 * The language of a fence's info string (`ts`, `tsx title="a.tsx"`) or of a file's path, by its whole name first
 * (Dockerfile) and then its extension; undefined for one shiki does not know.
 */
export function detectLanguage(text: string): BundledLanguage | undefined {
  const [word = ''] = text.trim().split(/\s/)
  const name = (word.split('/').at(-1) ?? '').toLowerCase()
  const extension = name.slice(name.lastIndexOf('.') + 1)
  return [name, extension].find((x): x is BundledLanguage => Object.hasOwn(bundledLanguages, x))
}

interface Token {
  content: string
  color?: string
  fontStyle?: number
}

/** Each token in its color and style, cut where a background starts or ends. */
function paintTokens(tokens: readonly Token[], backgrounds: readonly Background[]): string {
  let out = ''
  let at = 0
  for (const token of tokens) {
    const end = at + token.content.length
    // Where a background starts or ends inside the token, it is cut in two
    const cuts = [at, ...backgrounds.flatMap(b => [b.start, b.end]).filter(x => x > at && x < end), end]
    const sorted = [...new Set(cuts)].sort((a, b) => a - b)
    for (let i = 0; i < sorted.length - 1; i++) {
      const background = backgrounds.findLast(b => b.start <= sorted[i] && sorted[i] < b.end)
      out += sgr(token.content.slice(sorted[i] - at, sorted[i + 1] - at), token, background?.color)
    }
    at = end
  }
  return out
}

function sgr(text: string, { color, fontStyle = 0 }: Token, background: string | undefined): string {
  // fontStyle is -1 when the theme leaves it unset
  const codes: string[] = fontStyle > 0 ? STYLES.filter(([bit]) => fontStyle & bit).map(([, code]) => code) : []
  if (color !== undefined) {
    codes.push(`38;2;${rgb(color)}`)
  }
  if (background !== undefined) {
    codes.push(`48;2;${rgb(background)}`)
  }
  return codes.length === 0 || text === '' ? text : `\x1B[${codes.join(';')}m${text}\x1B[0m`
}

/** `#rrggbb` or `#rrggbbaa` as `r;g;b`; an alpha is left out. */
function rgb(hex: string): string {
  return [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16)).join(';')
}
