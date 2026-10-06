// Children one above the other: the ones that fill share the rows the others leave.

import type { Child, Element, Rendered } from './element.ts'
import { isShown, shareOf } from './element.ts'

/**
 * The children one above the other. The ones that fill share the rows the others leave, and are padded to their share;
 * with no height, each is as tall as it draws. When even that is too tall, the top is cut, to keep the bottom in view.
 */
export function stackVertically(children: Child[]): Element {
  const shown = children.filter(isShown)
  return {
    render: (width, height) => {
      // The ones that fill are drawn once the others say what they leave
      const sharing = height !== undefined
      const fixed = shown.map(child => (sharing && child.fill === true ? undefined : child.render(width)))
      const used = fixed.reduce((sum, block) => sum + (block?.rows.length ?? 0), 0)
      const fills = fixed.filter(block => block === undefined).length
      const room = Math.max(0, (height ?? 0) - used)

      let given = 0
      const blocks = shown.map((child, i) => {
        const block = fixed[i]
        if (block !== undefined) {
          return block
        }

        const share = shareOf(room, fills, given++)
        const { rows, cursor } = child.render(width, share)
        return { rows: Array.from({ length: share }, (_, y) => rows[y] ?? ''), cursor }
      })

      return keepBottom(joinVertically(blocks), height)
    },
  }
}

/** The blocks one after another, the first cursor moved down by the rows above it. */
function joinVertically(blocks: Rendered[]): Rendered {
  const rows: string[] = []
  let cursor: Rendered['cursor']
  for (const block of blocks) {
    if (cursor === undefined && block.cursor !== undefined) {
      cursor = { row: rows.length + block.cursor.row, column: block.cursor.column }
    }
    rows.push(...block.rows)
  }
  return { rows, cursor }
}

/** At most `height` rows, the last ones; a cursor in a row cut is hidden. */
function keepBottom({ rows, cursor }: Rendered, height: number | undefined): Rendered {
  if (height === undefined || rows.length <= height) {
    return { rows, cursor }
  }

  const cut = rows.length - height
  const kept = rows.slice(cut)
  if (cursor === undefined || cursor.row < cut) {
    return { rows: kept }
  }
  return { rows: kept, cursor: { row: cursor.row - cut, column: cursor.column } }
}
