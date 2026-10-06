// A menu of keys and what they do, one chosen: the commands that match what is typed after a `/`.

import type { KeyHint } from '../text.ts'
import type { Element } from './element.ts'
import { styleText } from 'node:util'
import { dimText, displayWidth, fitToWidth, paintKey } from '../text.ts'

/**
 * Each of `items` on a row, the keys lined up in a column, the `selected` one marked and its words not dim. Given a
 * height shorter than the items, the rows around the selected one.
 */
export function createMenuElement(items: KeyHint[], selected: number): Element {
  const keyWidth = Math.max(0, ...items.map(([key]) => displayWidth(key)))
  return {
    render: (width, height) => {
      const rows = items.map(([key, action], i) => {
        const padding = ' '.repeat(keyWidth - displayWidth(key))
        if (i === selected) {
          return fitToWidth(`${styleText('cyan', '❯')} ${paintKey(key)}${padding}  ${action}`, width)
        }
        return fitToWidth(`  ${paintKey(key)}${padding}  ${dimText(action)}`, width)
      })

      if (height === undefined) {
        return { rows }
      }
      const start = firstShown(selected, rows.length, height)
      return { rows: rows.slice(start, start + height) }
    },
  }
}

/** The first of the `height` rows of `count` that hold `index`: the first of all, until `index` is below them. */
function firstShown(index: number, count: number, height: number): number {
  return Math.max(0, Math.min(index - height + 1, count - height))
}
