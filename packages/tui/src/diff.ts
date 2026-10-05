// A diff in color: unified hunks without context lines, in the colors of the file they change.

import type { Background, PaintLine } from './highlight.ts'
import { styleText } from 'node:util'
import { DIFF_COLORS } from './highlight.ts'
import { dimText } from './text.ts'

/** Every hunk in its own colors; `start` starts a block in the file's language. */
export function paintDiff(patch: string, start: () => PaintLine): string {
  return patch
    .split(/\n(?=@@)/)
    .map(hunk => paintHunk(hunk, start))
    .join('\n')
}

/**
 * Without context lines a hunk is its removed lines, then its added ones: the k-th added line replaced the k-th
 * removed one, so the part where the two differ stands out. The removed lines run on in the file before, the added
 * ones in the file after, so each run is highlighted as a block.
 */
function paintHunk(hunk: string, start: () => PaintLine): string {
  const [header, ...lines] = hunk.split('\n')
  const removed = lines.filter(line => line.startsWith('-'))
  const added = lines.filter(line => line.startsWith('+'))
  const before = start()
  const after = start()

  const body = lines.map((line, i) => {
    if (line.startsWith('-')) {
      return paintChange(line, added[i], before, 'removed')
    }
    if (line.startsWith('+')) {
      return paintChange(line, removed[i - removed.length], after, 'added')
    }
    return dimText(line)
  })
  return [styleText('cyan', header), ...body].join('\n')
}

/** The sign in red or green, the code on its side's background, and what differs from `other` on a stronger one. */
function paintChange(line: string, other: string | undefined, paint: PaintLine, side: 'removed' | 'added'): string {
  const code = line.slice(1)
  const backgrounds: Background[] = [{ start: 0, end: code.length, color: DIFF_COLORS[side].line }]
  if (other !== undefined) {
    const { start, stop } = changedPart(code, other.slice(1))
    backgrounds.push({ start, end: stop, color: DIFF_COLORS[side].changed })
  }

  const sign = styleText(side === 'removed' ? 'red' : 'green', line[0])
  return `${sign}${paint(code, backgrounds)}`
}

/** Where `line` differs from `other`: what is left of it between the start and the end the two share. */
function changedPart(line: string, other: string): { start: number; stop: number } {
  let start = 0
  while (start < line.length && line[start] === other[start]) {
    start++
  }
  let end = 0
  while (end < line.length - start && end < other.length - start && line.at(-1 - end) === other.at(-1 - end)) {
    end++
  }
  return { start, stop: line.length - end }
}
