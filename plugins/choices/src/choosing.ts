// Questions being answered, apart from how they are drawn: press(state, key) gives the next state, and nothing else
// changes it.
//
//   one question        Enter answers it and ends; a multiple one takes Space to toggle options first
//   several questions   ←/→ move between them, Enter answers one and moves on, and the tab after the last sends
//   Other               the row after the options, where a question allows it: what is typed there is the answer

import type { Answers, Question } from './index.ts'

export interface Choosing {
  readonly questions: readonly Question[]
  /** The question shown; questions.length is the Send tab, which only several questions have. */
  readonly tab: number
  /** Per question, the row under the cursor; options.length is the Other row. */
  readonly rows: readonly number[]
  /** Per question, the values toggled on; only a multiple one has any. */
  readonly picked: readonly (readonly string[])[]
  /** Per question, the text typed on its Other row. */
  readonly typed: readonly string[]
  /** Per question, what Enter answered it with; undefined until then. */
  readonly answers: readonly (readonly string[] | undefined)[]
  /** Why the last Enter did nothing; the next key clears it. */
  readonly error?: string
  /** Every question is answered and sent: answers is complete. */
  readonly done: boolean
}

/** A key as readline reports it, with the character it typed. */
export interface Keypress {
  name?: string
  char?: string
  ctrl?: boolean
  meta?: boolean
}

export function start(questions: readonly Question[]): Choosing {
  return {
    questions,
    tab: 0,
    rows: questions.map(q =>
      Math.max(
        0,
        q.options.findIndex(o => o.value === q.initial),
      ),
    ),
    picked: questions.map(() => []),
    typed: questions.map(() => ''),
    answers: questions.map(() => undefined),
    done: false,
  }
}

export function press(state: Choosing, key: Keypress): Choosing {
  const s = { ...state, error: undefined }
  if (key.name === 'left' || key.name === 'right') {
    const last = s.questions.length === 1 ? 0 : s.questions.length
    return { ...s, tab: Math.min(Math.max(s.tab + (key.name === 'left' ? -1 : 1), 0), last) }
  }
  if (key.name === 'return') {
    return enter(s)
  }
  if (onSend(s)) {
    return s
  }

  const question = s.questions[s.tab]
  if (key.name === 'up' || key.name === 'down') {
    const count = rowCount(question)
    return { ...s, rows: s.rows.with(s.tab, (s.rows[s.tab] + (key.name === 'up' ? count - 1 : 1)) % count) }
  }
  if (onOther(s)) {
    return { ...s, typed: s.typed.with(s.tab, edit(s.typed[s.tab], key)) }
  }
  if (key.name === 'space' && question.multiple === true) {
    return { ...s, picked: s.picked.with(s.tab, toggle(s.picked[s.tab], question.options[s.rows[s.tab]].value)) }
  }
  return s
}

/** The answers, once done. */
export function sent(s: Choosing): Answers {
  return s.answers.map(a => [...(a ?? [])])
}

export function onSend(s: Choosing): boolean {
  return s.tab === s.questions.length
}

export function onOther(s: Choosing): boolean {
  return !onSend(s) && s.rows[s.tab] === s.questions[s.tab].options.length
}

/** Options plus the Other row, where there is one. */
export function rowCount(question: Question): number {
  return question.options.length + (question.other === true ? 1 : 0)
}

function enter(s: Choosing): Choosing {
  if (onSend(s)) {
    const missing = s.answers.indexOf(undefined)
    return missing === -1 ? { ...s, done: true } : { ...s, tab: missing, error: 'Answer this one first.' }
  }

  const answer = answerOf(s)
  if (answer === undefined) {
    return { ...s, error: 'Type an answer, or pick an option.' }
  }

  const answers = s.answers.with(s.tab, answer)
  return s.questions.length === 1 ? { ...s, answers, done: true } : { ...s, answers, tab: s.tab + 1 }
}

/** What Enter answers with: undefined when the cursor is on Other and nothing is typed. */
function answerOf(s: Choosing): string[] | undefined {
  const question = s.questions[s.tab]
  const typed = s.typed[s.tab].trim()
  const own = typed === '' ? [] : [typed]

  if (question.multiple === true) {
    return [...question.options.map(o => o.value).filter(v => s.picked[s.tab].includes(v)), ...own]
  }
  const option = question.options.at(s.rows[s.tab])
  if (option !== undefined) {
    return [option.value]
  }
  return typed === '' ? undefined : own
}

function edit(text: string, key: Keypress): string {
  if (key.name === 'backspace') {
    return text.slice(0, -1)
  }
  const printable = key.char !== undefined && key.char.length === 1 && key.char >= ' '
  return printable && key.ctrl !== true && key.meta !== true ? text + key.char : text
}

function toggle(picked: readonly string[], value: string): string[] {
  return picked.includes(value) ? picked.filter(v => v !== value) : [...picked, value]
}
