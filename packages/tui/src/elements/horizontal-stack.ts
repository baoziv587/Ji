// Children side by side: the ones without a width share the columns the others leave.

import type { Child, Element, Rendered } from './element.ts'
import { displayWidth } from '../text.ts'
import { isShown, shareOf } from './element.ts'

/** A child drawn, and where it is. */
interface Column {
  block: Rendered
  left: number
  width: number
}

/**
 * The children side by side, `separator` between each two. One without a `width` takes the columns the others leave,
 * shared with the other ones without; when they are too wide even so, the ones on the right are cut.
 */
export function stackHorizontally(children: Child[], { separator = '' }: { separator?: string } = {}): Element {
  const shown = children.filter(isShown)
  return {
    render: (width, height) => {
      const columns = renderColumns(shown, width, height, displayWidth(separator))

      const tallest = Math.max(0, ...columns.map(({ block }) => block.rows.length))
      const rows = Array.from({ length: height ?? tallest }, (_, y) => joinRow(columns, y, separator))

      return { rows, cursor: firstCursor(columns) }
    },
  }
}

/** Each child drawn at its place from the left, `gap` columns apart; the ones that start past the width are left out. */
function renderColumns(children: Element[], width: number, height: number | undefined, gap: number): Column[] {
  const fixed = children.reduce((sum, child) => sum + (child.width ?? 0), 0) + gap * (children.length - 1)
  const fills = children.filter(child => child.width === undefined).length
  const room = Math.max(0, width - fixed)

  let given = 0
  let end = 0
  const columns: Column[] = []
  for (const child of children) {
    const left = columns.length === 0 ? 0 : end + gap
    const wanted = child.width ?? shareOf(room, fills, given++)
    const fitting = Math.min(wanted, width - left)
    if (fitting <= 0) {
      continue
    }

    columns.push({ block: child.render(fitting, height), left, width: fitting })
    end = left + fitting
  }
  return columns
}

/** Row `y` of every column, each but the last padded to its width, with `separator` between them. */
function joinRow(columns: Column[], y: number, separator: string): string {
  const parts = columns.map(({ block, width }, i) => {
    const row = block.rows[y] ?? ''
    if (i === columns.length - 1) {
      return row
    }
    return row + ' '.repeat(Math.max(0, width - displayWidth(row)))
  })
  return parts.join(separator)
}

/** The first column's cursor, moved right by the columns before it. */
function firstCursor(columns: Column[]): Rendered['cursor'] {
  for (const { block, left } of columns) {
    if (block.cursor !== undefined) {
      return { row: block.cursor.row, column: left + block.cursor.column }
    }
  }
  return undefined
}
