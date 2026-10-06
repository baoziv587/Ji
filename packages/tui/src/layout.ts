// A path shortened to fit, from its start, or with the home folder as `~`; and a help screen of keys in columns.

import type { KeyHint } from './text.ts'
import { homedir } from 'node:os'
import { wrapAnsi } from 'fast-wrap-ansi'
import { dimText, displayWidth, paintKey } from './text.ts'

/** A part of a help screen: a title, then keys in a column, or text wrapped under it. */
export interface HelpSection {
  title: string
  rows: KeyHint[] | string
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
