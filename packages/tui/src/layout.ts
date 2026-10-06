// Fitting a line to the width it has: the first of several versions that fits, a path shortened from its start, a
// rule with labels at its end; and a help screen of keys in columns.

import type { KeyHint } from './text.ts'
import { homedir } from 'node:os'
import { wrapAnsi } from 'fast-wrap-ansi'
import { dimText, displayWidth, paintKey } from './text.ts'

/** A part of a help screen: a title, then keys in a column, or text wrapped under it. */
export interface HelpSection {
  title: string
  rows: KeyHint[] | string
}

/** The narrowest a rule's lines run before its labels, for it to still read as a rule. */
const MIN_RULE = 8

/** The first of `lines`, longest first, that fits in `width` columns; undefined when none does. */
export function pickFirstThatFits(width: number, lines: string[]): string | undefined {
  return lines.find(line => displayWidth(line) <= width)
}

/** `~/a/b/c`, then `…/b/c`, then `…/c`: the path with its first folders left out, one at a time. */
export function leftTruncatedPaths(path: string): string[] {
  const folders = path.split('/')
  const shortened = [path]
  for (let start = 1; start < folders.length; start++) {
    shortened.push(`…/${folders.slice(start).join('/')}`)
  }
  return shortened
}

/** `~/projects/app` for a folder under the home folder; any other stays as it is. */
export function abbreviateHomePath(path: string): string {
  const home = homedir()
  if (path !== home && !path.startsWith(`${home}/`)) {
    return path
  }
  return `~${path.slice(home.length)}`
}

/** A dim rule `width` columns wide with as many of `labels` at its right end as fit, from the first. */
export function drawRuleWithLabels(width: number, labels: string[]): string {
  for (let shown = labels.length; shown > 0; shown--) {
    const label = ` ${labels.slice(0, shown).join(' · ')} `
    const left = width - displayWidth(label) - 1
    if (left >= MIN_RULE) {
      return dimText(`${'─'.repeat(left)}${label}─`)
    }
  }
  return dimText('─'.repeat(width))
}

/** Each section under its title: keys in bold, lined up in one column across sections; text wrapped to `width`. */
export function formatHelpSections(sections: HelpSection[], width: number): string {
  const keys = sections.flatMap(({ rows }) => (typeof rows === 'string' ? [] : rows))
  const keyWidth = Math.max(0, ...keys.map(([key]) => displayWidth(key)))

  const lines: string[] = []
  for (const { title, rows } of sections) {
    lines.push(title)
    if (typeof rows === 'string') {
      lines.push(...wrappedRows(rows, width - 2))
    } else {
      lines.push(...keyRows(rows, keyWidth))
    }
  }
  return lines.join('\n')
}

/** `text` wrapped to `width`, dim, each row indented under its title. */
function wrappedRows(text: string, width: number): string[] {
  return wrapAnsi(text, width)
    .split('\n')
    .map(row => `  ${dimText(row)}`)
}

/** A key a row, padded to `keyWidth`, then what it does, dim. */
function keyRows(hints: KeyHint[], keyWidth: number): string[] {
  return hints.map(([key, action]) => {
    const padding = ' '.repeat(keyWidth - displayWidth(key))
    return `  ${paintKey(key)}${padding}  ${dimText(action)}`
  })
}
