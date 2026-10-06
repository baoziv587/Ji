// Text wrapped to the width.

import type { Element } from './element.ts'
import { wrapAnsi } from 'fast-wrap-ansi'
import { fitToWidth } from '../text.ts'

/** `text` wrapped at its spaces to the width; a word longer than the width is broken. */
export function createWrappedTextElement(text: string): Element {
  return {
    render: (width, height) => ({
      // A wide character in a narrower width is cut too
      rows: wrapAnsi(text, Math.max(1, width), { hard: true })
        .split('\n')
        .slice(0, height)
        .map(row => fitToWidth(row, width)),
    }),
  }
}
