// Columns kept free on either side of an element.

import type { Element } from './element.ts'

/** `child` with columns kept free on either side; it fills, and its width counts them. */
export function padElement(child: Element, { left = 0, right = 0 }: { left?: number; right?: number }): Element {
  let padded: number | undefined
  if (child.width !== undefined) {
    padded = child.width + left + right
  }

  return {
    fill: child.fill,
    width: padded,
    render: (width, height) => {
      const margin = ' '.repeat(Math.min(left, width))
      const { rows, cursor } = child.render(Math.max(0, width - left - right), height)

      return {
        rows: rows.map(row => margin + row),
        cursor: cursor && { row: cursor.row, column: margin.length + cursor.column },
      }
    },
  }
}
