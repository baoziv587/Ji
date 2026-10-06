// The line typed in a bar: applyKey(state, key) gives the next state, and createInputElement draws it. formatKeypress
// names a key, for a switch over the ones a program handles.
//
//   ←/→ and Ctrl+A/E move · Backspace/Delete · Ctrl+U/K delete to the start/end · Ctrl+W deletes a word
//   Enter is left to the caller, which sends the text; inside a paste it is a space, so a paste sends nothing

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
  shift?: boolean
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

  return isPrintable(key.char) && key.meta !== true ? { ...s, before: before + key.char } : s
}

/** `ctrl+o`, `shift+tab`, `return`, `up`; a character typed without Ctrl or Alt is itself: `a`, `A`, `/`. */
export function formatKeypress(key: Keypress): string {
  if (isPrintable(key.char) && key.ctrl !== true && key.meta !== true) {
    return key.char
  }

  const modifiers = (['ctrl', 'meta', 'shift'] as const).filter(modifier => key[modifier] === true)
  return [...modifiers, key.name ?? key.char ?? ''].join('+')
}

const graphemes = new Intl.Segmenter()

function isPrintable(char: string | undefined): char is string {
  return char !== undefined && char !== '' && !/\p{Cc}/u.test(char)
}

function firstGrapheme(text: string): string {
  return graphemes.segment(text)[Symbol.iterator]().next().value?.segment ?? ''
}

/** Looked up from the end, so a long text costs no more than a short one. */
function lastGrapheme(text: string): string {
  return text === '' ? '' : graphemes.segment(text).containing(text.length - 1)!.segment
}
