// Lines of text, each cut to the width.

import type { Element } from './element.ts'
import { fitToWidth } from '../text.ts'

/** `text`'s lines, each cut to the width. */
export function createTextElement(text: string | string[]): Element {
  const lines = typeof text === 'string' ? text.split('\n') : text
  return {
    render: (width, height) => ({ rows: lines.slice(0, height).map(line => fitToWidth(line, width)) }),
  }
}
