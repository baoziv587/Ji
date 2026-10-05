// The line typed in a bar: applyKey(state, key) gives the next state, and renderInputLine draws it.
//
//   ←/→ and Ctrl+A/E move · Backspace/Delete · Ctrl+U/K delete to the start/end · Ctrl+W deletes a word
//   Enter is left to the caller, which sends the text; inside a paste it is a space, so a paste sends nothing

import { styleText } from 'node:util'
import { dimText, displayWidth, fitToWidth, tailToWidth } from './text.ts'

export interface Editing {
  /** The text before the cursor. */
  readonly before: string
  /** The text after it. */
  readonly after: string
  /** Between the terminal's paste markers. */
  readonly pasting: boolean
}

/** A key as readline reports it, with the character it typed. */
export interface Keypress {
  name?: string
  char?: string
  ctrl?: boolean
  meta?: boolean
}

/** The input line drawn: its row, and the cursor's column in it. */
export interface InputLine {
  line: string
  column: number
}

export interface InputLineOptions {
  /** Shown dim while nothing is typed. */
  placeholder: string
  /** The keys are something else's: the prompt is gray and the text dim. */
  muted?: boolean
}

export const EMPTY_EDITING: Editing = { before: '', after: '', pasting: false }

export function editingText(s: Editing): string {
  return s.before + s.after
}

export function applyKey(s: Editing, key: Keypress): Editing {
  const { before, after } = s
  if (key.ctrl === true) {
    switch (key.name) {
      case 'a':
        return { ...s, before: '', after: before + after }
      case 'e':
        return { ...s, before: before + after, after: '' }
      case 'u':
        return { ...s, before: '' }
      case 'k':
        return { ...s, after: '' }
      case 'w':
        return { ...s, before: before.replace(/\S*\s*$/, '') }
    }
    return s
  }

  switch (key.name) {
    case 'paste-start':
      return { ...s, pasting: true }
    case 'paste-end':
      return { ...s, pasting: false }
    case 'return':
    case 'enter':
      return s.pasting ? { ...s, before: `${before} ` } : s
    case 'left': {
      const last = lastGrapheme(before)
      return { ...s, before: before.slice(0, before.length - last.length), after: last + after }
    }
    case 'right': {
      const first = firstGrapheme(after)
      return { ...s, before: before + first, after: after.slice(first.length) }
    }
    case 'home':
      return { ...s, before: '', after: before + after }
    case 'end':
      return { ...s, before: before + after, after: '' }
    case 'backspace':
      return { ...s, before: before.slice(0, before.length - lastGrapheme(before).length) }
    case 'delete':
      return { ...s, after: after.slice(firstGrapheme(after).length) }
  }

  const printable = key.char !== undefined && key.char !== '' && !/\p{Cc}/u.test(key.char)
  return printable && key.meta !== true ? { ...s, before: before + key.char } : s
}

/** The prompt, then the text around the cursor, scrolled sideways to keep the cursor in view. */
export function renderInputLine(
  editing: Editing,
  width: number,
  { placeholder, muted = false }: InputLineOptions,
): InputLine {
  const prompt = `${styleText(muted ? 'gray' : 'cyan', '›')} `
  const space = width - 2
  if (editingText(editing) === '') {
    return { line: prompt + fitToWidth(dimText(placeholder), space), column: 2 }
  }

  // At least the cursor's own cell stays free after the text before it
  const left = tailToWidth(editing.before, space - 1)
  const right = fitToWidth(editing.after, space - displayWidth(left))
  const text = left + right
  return { line: prompt + (muted ? dimText(text) : text), column: 2 + displayWidth(left) }
}

const graphemes = new Intl.Segmenter()

function firstGrapheme(text: string): string {
  return graphemes.segment(text)[Symbol.iterator]().next().value?.segment ?? ''
}

/** Looked up from the end, so a long text costs no more than a short one. */
function lastGrapheme(text: string): string {
  return text === '' ? '' : graphemes.segment(text).containing(text.length - 1)!.segment
}
