// A full-screen terminal chat's parts, none of them knowing what is said in it:
//
//   screen     the alternate screen, drawn from a tree of elements; the content one of them, scrolled with the
//              wheel and PgUp/PgDn, its live rows changing in place; a status that spins and counts the seconds
//   elements   the screen as a tree of elements: text, two stacks, padding, a rule, the input line drawn
//   editing    the line typed in a bar, and what keys do to it; a key's name
//   markdown   Markdown as it streams in, in rows that fit; plain text the same way
//   rail       rows written beside clack's rail
//   highlight  code in color, a line at a time; diff     a diff in the colors of its file
//   layout     a path shortened to fit; help
//   output     the tail of a running command's output
//   text       text cut and wrapped by the columns it shows in; dim text, key hints, counts

export { paintDiff } from './diff.ts'
export type { Editing, Keypress } from './editing.ts'
export { applyKey, editingText, EMPTY_EDITING, formatKeypress } from './editing.ts'
export type { Element, Rendered } from './elements/element.ts'
export { createFirstThatFitsElement } from './elements/first-that-fits.ts'
export { stackHorizontally } from './elements/horizontal-stack.ts'
export type { InputElementOptions } from './elements/input.ts'
export { createInputElement } from './elements/input.ts'
export { padElement } from './elements/pad.ts'
export { createRuleElement } from './elements/rule.ts'
export { createTextElement } from './elements/text.ts'
export { stackVertically } from './elements/vertical-stack.ts'
export { createWrappedTextElement } from './elements/wrapped-text.ts'
export type { Background, PaintLine } from './highlight.ts'
export { detectLanguage, DIFF_COLORS, highlightCode, loadCodePainter } from './highlight.ts'
export type { HelpSection } from './layout.ts'
export { abbreviateHomePath, formatHelpSections, leftTruncatedPaths } from './layout.ts'
export type { Rows } from './markdown/flow.ts'
export type { Format } from './markdown/inline.ts'
export { Markdown } from './markdown/markdown.ts'
export { PlainText } from './markdown/plain.ts'
export { OutputTail } from './output.ts'
export { createRailRows, paintRail, widthBesideRail } from './rail.ts'
export type { LiveRows } from './screen/live.ts'
export { SPINNER_FRAMES } from './screen/live.ts'
export type { View } from './screen/screen.ts'
export { Screen } from './screen/screen.ts'
export { Status } from './status.ts'
export type { KeyHint } from './text.ts'
export {
  clipToLine,
  dimText,
  displayWidth,
  fitToWidth,
  formatCount,
  formatKeyHint,
  formatKeyHints,
  paintKey,
  splitWords,
  tailToWidth,
  wrapToRows,
} from './text.ts'
