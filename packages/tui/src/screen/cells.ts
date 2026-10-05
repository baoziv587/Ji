// A line of the headless terminal back into text with its colors, to draw on the real one.

import type { IBufferCell, IBufferLine } from '@xterm/headless'

/** Each attribute and its SGR code; xterm reports an attribute as a nonzero number. */
const STYLES: [on: (cell: IBufferCell) => number, code: number][] = [
  [cell => cell.isBold(), 1],
  [cell => cell.isDim(), 2],
  [cell => cell.isItalic(), 3],
  [cell => cell.isUnderline(), 4],
  [cell => cell.isInverse(), 7],
  [cell => cell.isInvisible(), 8],
  [cell => cell.isStrikethrough(), 9],
]

/** The first `width` cells of `line`, styled as they were written; `cell` is reused, to spare allocating one per cell. */
export function lineOf(line: IBufferLine | undefined, width: number, cell: IBufferCell): string {
  let out = ''
  let style = ''
  for (let x = 0; x < width; x++) {
    const at = line?.getCell(x, cell)
    // The second half of a wide character is drawn by its first
    if (at?.getWidth() === 0) {
      continue
    }

    const next = at === undefined ? '' : sgrOf(at)
    if (next !== style) {
      out += `\x1B[0m${next}`
      style = next
    }
    const chars = at?.getChars() ?? ''
    out += chars === '' ? ' ' : chars
  }
  return style === '' ? out : `${out}\x1B[0m`
}

/** Every line, the wrapped ones joined to the line before so a terminal of any width can wrap them again. */
export function textOf(lines: (IBufferLine | undefined)[], cell: IBufferCell): string {
  const rows = lines.map(line => ({
    text: lineOf(line, used(line, cell), cell),
    wrapped: line?.isWrapped === true,
  }))
  while (rows.at(-1)?.text === '') {
    rows.pop()
  }
  return rows.map((row, i) => (i === 0 || row.wrapped ? row.text : `\n${row.text}`)).join('')
}

/** How many cells of the line hold something: trailing blanks are left out. */
function used(line: IBufferLine | undefined, cell: IBufferCell): number {
  for (let x = (line?.length ?? 0) - 1; x >= 0; x--) {
    const at = line?.getCell(x, cell)
    if (at !== undefined && (at.getChars() !== '' || !at.isBgDefault())) {
      return x + at.getWidth()
    }
  }
  return 0
}

/** The SGR sequence that styles a cell like this one; empty for a plain one. Built as a string: it runs for every cell. */
function sgrOf(cell: IBufferCell): string {
  // Most cells are plain
  if (cell.isAttributeDefault()) {
    return ''
  }

  let codes = ''
  for (const [on, code] of STYLES) {
    if (on(cell) !== 0) {
      codes += `;${code}`
    }
  }
  codes += colorOf(cell.isFgRGB(), cell.isFgPalette(), cell.getFgColor(), 30)
  codes += colorOf(cell.isBgRGB(), cell.isBgPalette(), cell.getBgColor(), 40)
  return codes === '' ? '' : `\x1B[${codes.slice(1)}m`
}

/** Codes, each after a `;`; `base` is 30 for the foreground and 40 for the background. */
function colorOf(rgb: boolean, palette: boolean, color: number, base: number): string {
  if (rgb) {
    return `;${base + 8};2;${(color >> 16) & 255};${(color >> 8) & 255};${color & 255}`
  }
  if (!palette) {
    return ''
  }
  if (color < 8) {
    return `;${base + color}`
  }
  return color < 16 ? `;${base + 60 + color - 8}` : `;${base + 8};5;${color}`
}
