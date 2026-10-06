// One line, the first of several versions that fits the width.

import type { Element } from './element.ts'
import { displayWidth, fitToWidth } from '../text.ts'

/** The first of `versions`, longest first, that fits; when none does, the last one cut to fit. */
export function createFirstThatFitsElement(versions: string[]): Element {
  return {
    render: width => {
      const fitting = versions.find(version => displayWidth(version) <= width)
      return { rows: [fitting ?? fitToWidth(versions.at(-1) ?? '', width)] }
    },
  }
}
