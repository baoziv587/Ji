// The input line: the prompt, then the text around the cursor, scrolled sideways to keep the cursor in view. What a key
// does to the text is editing.ts's; this only draws it.

import type { Editing } from '../editing.ts'
import type { Element } from './element.ts'
import { styleText } from 'node:util'
import { editingText } from '../editing.ts'
import { dimText, displayWidth, fitToWidth, tailToWidth } from '../text.ts'

export interface InputElementOptions {
  /** Shown dim while nothing is typed. */
  placeholder: string
  /** The keys are something else's: the prompt is gray, the text dim, and the cursor hidden. */
  muted?: boolean
}

/** The prompt's width: `› `. */
const PROMPT = 2

export function createInputElement(editing: Editing, { placeholder, muted = false }: InputElementOptions): Element {
  return {
    render: width => {
      const prompt = `${styleText(muted ? 'gray' : 'cyan', '›')} `
      const space = width - PROMPT

      let line: string
      let column = PROMPT
      if (editingText(editing) === '') {
        line = prompt + fitToWidth(dimText(placeholder), space)
      } else {
        // At least the cursor's own cell stays free after the text before it
        const left = tailToWidth(editing.before, space - 1)
        const right = fitToWidth(editing.after, space - displayWidth(left))
        line = prompt + (muted ? dimText(left + right) : left + right)
        column += displayWidth(left)
      }

      if (muted) {
        return { rows: [line] }
      }
      return { rows: [line], cursor: { row: 0, column } }
    },
  }
}
